# Figma to native Bricks compiler

## Current workflow (14 October 2026)

The existing extraction, normalization, structure reconciliation, responsive compilation, section merge, media handling and MCP injection remain in place. Generation runs **nonvisual validation only**. Visual debugging is a separate manual tool for one layout problem you report after inspecting the frontend.

Use Node.js 20+. A browser and a vision provider are optional dependencies for manual debugging, not normal generation. On Windows use `npm.cmd` when PowerShell blocks `npm.ps1`. Configure Figma and WordPress credentials in the ignored `.env`. Keep them out of Git.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run schema:sync
# Build saved AI-normalized sections, validate JSON/media, and leave WordPress untouched.
npm.cmd run pipeline -- --frame output/casinofx-homepage --no-inject
# Deterministic normalization from measured Figma data; no AI provider needed.
npm.cmd run pipeline -- "<figma-url-with-node-id>" --deterministic --no-inject
# Generate and insert a NEW draft on your configured local/staging site.
npm.cmd run pipeline -- "<figma-url-with-node-id>" --deterministic
# Re-fetch changed Figma data and assets, then build locally.
npm.cmd run pipeline -- "<figma-url-with-node-id>" --refresh --deterministic --no-inject
# Saved-input, nonvisual regression across the existing designs.
npm.cmd run regression
npm.cmd run validate -- output/casinofx-homepage/merged/bricks-tree.json
```

Normal injection creates a draft. `--page <id>` updates that existing page; use it only for a deliberately selected local/staging target. No visual review, screenshot comparison, browser sweep, or vision API call runs after generation. Missing assets, invalid hierarchy, unsupported native settings and failed sections stop saving. Partial builds need an explicit `--inject-partial`.

`--no-visual` remains an accepted compatibility option and is unnecessary. Pipeline `--visual-review-only` and `--visual-iterations` are rejected with instructions to use the manual tool.

## Figma and native components

Raw hierarchy and geometry remain the primary reference. Measured reconciliation preserves Auto Layout gap/padding/alignment, fill/hug sizing, constraints, absolute positions, clipping, text and styles. Preserved source/coverage reports record hidden nodes, exported graphics and unsupported effects. Unsupported information is reported rather than described as successfully rendered.

Semantic recognition uses names, hierarchy, links, component annotations and design evidence. It maps verified native navigation, slider, tabs, accordion and form structures using the installed Bricks runtime schemas. A horizontal card row is not automatically a carousel. Link destinations, form actions and autoplay are not invented. Component recognition reports explain decisions and remaining configuration needs. Existing classes/variables can be referenced; the compiler does not create global design-system resources automatically.

The connected site's schemas and context live in `schema/runtime/`; refresh them for another site/version. Client-side Bricks skills are optional guidance and do not run inside the compiler. See [UPGRADE_AUDIT.md](UPGRADE_AUDIT.md) for discovered abilities, skills and verified site capabilities.

## Responsive generation

The compiler uses the saved Bricks breakpoint keys and generates stacking, grid column, spacing and width rules during compilation. Native navigation and sliders use their supported mobile settings. No screenshot system validates responsiveness.

When separate responsive Figma frames have been extracted, map their corresponding elements explicitly in `output/<frame>/responsive-frame-map.json`. Source paths are relative to that output folder:

```json
{
  "tablet_portrait": {
    "source": "../tablet-frame/figma-node.json",
    "nodes": { "desktop-figma-node-id": "tablet-figma-node-id" }
  },
  "mobile_portrait": {
    "source": "../mobile-frame/figma-node.json",
    "nodes": { "desktop-figma-node-id": "mobile-figma-node-id" }
  }
}
```

Mapped measurements override inferred values. Unknown breakpoint keys, missing source nodes and ambiguous correspondences fail explicitly. The system does not fetch missing sibling frames or infer matching nodes solely from their names. Current automatic rules are desktop-first; mobile-first sites require explicit responsive data and `--no-responsive` in direct compilation.

## Manual layout debugging

Run this only after you observe a problem, providing its section and frontend URL:

```powershell
npm.cmd run visual -- output/casinofx-homepage --only=section-03 --problem="The image overlaps the text" --page-url="https://your-staging-site/page/" --width=1440
# Prepare one targeted local candidate and recheck that issue once.
npm.cmd run visual -- output/casinofx-homepage --only=section-03 --problem="The image overlaps the text" --page-url="https://your-staging-site/page/" --fix
```

For an explicitly approximate local diagnosis, replace `--page-url` with `--local-preview`. `--render-only` captures the selected view without an AI call. Exactly one section and a problem description are required. Only one reported viewport is captured. The tool cannot modify other sections, content/media, appearance or breakpoint settings; unchanged and conflicting patches are rejected. It does not audit responsiveness, menus, sliders, animations, accessibility, performance or pixel-perfect accuracy.

Actual frontend capture is the diagnosis reference. A locally rendered candidate is **not** proof that the actual frontend issue was fixed. Candidates are saved for review and authorized staging application. Provider errors affect this manual operation only. Original trees, answers and snapshots remain recoverable under `visual/` and `.review-work/upgrade-backup-*`. Default tests exclude browser/image-comparison integration tests; the archived manual tool test file is explicitly invoked only when maintaining that tool.

## Reliability and transfer

Figma cache identity includes file/node; `--refresh` updates inputs. Saved model parts are keyed by prompt contents. Normalization source records include the input hash and deterministic/AI mode. Namespace files preserve IDs across directories/devices. Failed sections never reuse stale compiled trees in a merge. Dataset comparisons use the actual injected snapshot where available.

For GitHub transfer and your RTX 3050 laptop, see [MIGRATION.md](MIGRATION.md). Ollama is optional: deterministic builds do not need it. Manual vision debugging can use your existing provider or a configured Ollama vision model. No model is downloaded silently.

Historical setup and change logs below describe earlier versions. This workflow defines current behavior. Actual frontend quality and interactive behavior remain unverified until tested on the generated draft.

## Pipeline stages

```text
1_extract_figma.js       Raw Figma node, metadata, screenshot and exported assets
2_normalize.js           Deterministic hierarchy/measurements or AI interpretation
3_compile_bricks.js      Reconcile geometry, recognize components, native responsive JSON
merge_sections.js        Merge valid built sections and wrap import template
validate-build.js        Nonvisual hierarchy, native schema, component and media checks
4_inject_mcp.js          Media resolution, native rendering acceptance, draft/page insertion
export-dataset.js        Preserve compiled/injected snapshots and hand-edit comparisons
6_visual_review.js       MANUAL ONLY: diagnose one reported layout issue
5_measure.js             Legacy explicitly invoked DOM measurement tool
```

`node scripts/run-all.js <figma-url>` remains a local build alias that skips injection. It never invokes visual debugging.


## Setup

```bash
npm install
cp .env.example .env
# fill in FIGMA_TOKEN, ANTHROPIC_API_KEY, WP_BASE_URL, WP_APP_USER, WP_APP_PASSWORD
```

### 1. Figma token
Figma → Settings → Personal access tokens → generate. Needs read access to the file.

### 2. WordPress Application Password
wp-admin → Users → your profile → Application Passwords → create one named
`figma-to-bricks`. Needed to push page content via the REST API without exposing
your real login password. Requires an admin/editor role.

### 3. Seed examples (critical — do this before running the LLM step)
Drop 3-5 of your real Figma → Bricks pairs into `examples/`:

```
examples/
  hero-01/
    figma-node.json      (raw Figma API response for that frame, or just the relevant excerpt)
    bricks-export.json   (the real _bricks_page_content_2 value for that section)
  card-grid-01/
    figma-node.json
    bricks-export.json
  ...
```

These are what make step 2 reliable — the LLM is shown real paired examples of
"this Figma structure" -> "this normalized shape", not asked to invent Bricks
syntax from a description. See `examples/README.md`.

### 4. Bricks schema (fill this in from your real exports — see below)
`3_compile_bricks.js` currently ships with placeholder mappings for a handful of
common elements (section, container, heading, text, button, image). Before this
will produce valid output for YOUR site, you need to walk through 2-3 of your
real `bricks-export.json` files and correct `bricks-schema.js` to match exactly
what Bricks expects (required keys, default settings, your actual global class
names). This is Phase 0 from the earlier roadmap — do it by inspection, not by
guessing. I've left `// VERIFY AGAINST YOUR EXPORTS` markers everywhere this matters.

## Original milestone 1 limitations (historical)
- No auto-correction loop (step 5 produces a diff report; you or a second LLM
  call decide the fix — wiring that up is milestone 2)
- No component-reuse detection ("this looks like our Card component")
- Single frame/section at a time, not full pages
- No Elementor/Gutenberg targets — Bricks only, per your priority

---

## 10. Change log: structure pass (9 Oct 2026)

**Why:** a hand-edited Bricks export (`hand-made.json`) was compared with the compiler output (`compiler-gentered.json`, 622 elements, 287 divs). The hand edit removed about 40 elements (mostly empty wrapper divs), set two section backgrounds the compiler missed, and turned card titles into `h3` headings.

**Root causes found**
1. Header (`#282828`) and the hero-mobile section (`#101010`) each sit on a full-width Figma rectangle. The section is a top-level "scope" node with no geometry parent, so the rectangle never reached the model and the page-black fallback was used.
2. Wrapper columns/rows with a single child come from the model's grouping, and no later step collapsed them.
3. A card's title and description were both emitted as plain `text`.

**What changed (all deterministic, no model calls, existing `normalized.json` files are reused)**
- NEW `scripts/structure-pass.js`, run in stage 3 before `responsive-pass.js`. Every action prints a `structure:` line in the compile log.
  - Rule 1, background recovery: a section with no fill and no image gets the colour of the smallest full-width solid Figma rectangle behind its content.
  - Rule 2, wrapper removal: a row/column with one child and no fill, border, size, padding, margin, justify or differing alignment is replaced by its child.
  - Rule 3, card titles: a column that holds only `[bold text >= 600 and >= 16px, lighter text...]` turns the first text into an `h3`.
  - Rule 4, missing-text check (report only): Figma text inside a section's area that appears nowhere in the normalized tree is logged as `MISSING TEXT`. Nothing is inserted, because guessing a position is riskier than flagging it. It found none on this page.
- EDIT `scripts/3_compile_bricks.js`: calls the pass. Add `--no-structure` to switch it off.
- `merge_sections.js` is unchanged: the page-background fallback now only fills sections that still have no background (18 of 20).

**Result on the 20 sections (checked by running the compiler)**

| | before | after | hand-made |
|---|---|---|---|
| elements | 622 | 596 | 591 |
| divs | 287 | 261 | 262 |
| section backgrounds | 2 wrong | `#282828`, `#101010` as in hand-made | |
| `h3` card titles | 61 headings | 73 headings | |

Merged tree checked: ids unique, every parent/children link consistent, 596 elements.

**Not done / still open**
- Layered decorative icons (6 icons the hand edit removed) and divider-to-border mapping are not implemented.
- 12 titles became `h3`, 6 more than the hand-made file shows. The other six are game-card titles with the same shape as "Jili Table Games", which the hand-made file does have as `h3`, but the hand-made export may simply not contain them. Check once in the browser.
- Not yet injected into WordPress and not compared visually against Figma. Run section 4, then the QA checklist in section 7.

---

## 11. Change log: pseudo-element layers and widths (9 Oct 2026, second pass)

Based on the corrected `hand-made.json`: its yellow Conclusion card uses `::before` / `::after` background images, and several max-widths were corrected to the Figma frame.

**Decoration layers as pseudo-elements (new, deterministic)**
- NEW `scripts/decoration-detect.js`, shared by stage 1 and stage 3. A *panel* is a shape-only group (no text, no photo fill, at least 300px wide) behind a section's content, for example a rectangle + masked pattern + vector. The solid rectangle that covers it is the **background** (colour and corner radius). Every other visible shape in it is a **layer**, at most two (one `::before`, one `::after`).
- `1_extract_figma.js` now exports each layer as ONE svg (a "Decoration layer ..." line in the log). Stage 1 must be run again once. Cached Figma data and existing assets are reused, so only the new svgs are fetched.
- `structure-pass.js` matches the panel to a section. A panel narrower than the page becomes a **card**: the section's container gets its colour, radius, vertical padding measured from Figma (88/88 here), 16px sides, `max-width` = panel width, and the layers. A full-width panel puts its layers on the **section** itself.
- `bricks-schema.js` writes Bricks settings keys, one set per layer. Replace `before` with `after` for the second layer:
  `_content::before = " "`, `_position::before = absolute`, `_background::before = { image, size, position, repeat }`, and `_top/_right/_bottom/_left::before = 0` (or `_left/_top/_width/_height::before` in %/px when the layer is smaller than the card).
  The host element gets `_position: relative` and `_overflow: hidden`. A small `_cssCustom` block puts the pseudo-elements behind the content and stops them taking clicks (`pointer-events: none`, content `z-index: 1`).
- Section 18 (Conclusion) now compiles to the same container the hand-made file has (`#FCC40B`, radius 16, padding 88/16, `1200px`, relative, hidden, `::before` layer). The hand-made file also nests the whole card group as a second layer; the compiler uses the inner mask group only.
- Key spelling: the hand-made file contains both `_x:before` and `_x::after`. The compiler writes the double-colon form. If Bricks rejects a key on save, `--fix-keys` reports it, and the spelling is one template string in `applyLayers` in `bricks-schema.js`.

**Widths**
- A section whose Figma scope is narrower than the site container (section-17: 1003px, section-19: 1049px) now sets the **container** max-width itself, and the block inside fills it. All 20 container widths now equal the hand-made file's.
- A container-div with no width inside a column now says `width 100%` when its measured Figma width is at least 90% of its parent's, so flex centring/start alignment no longer shrinks it to its content. A centred narrower one gets its measured width as `max-width`. That adds `_width: 100%` to many divs (146 against 44 in the hand-made file); it renders the same where the div already fills its parent.
- Measured `max-width` on divs: 16 of the 17 in the hand-made file are reproduced.

**Not covered yet:** about half of the places where the hand-made file added `width 100%` (for example grid-cell content and the FAQ items) are not reproduced; the hand-made file puts the width on a child that is narrower than its parent in Figma. Send the sections where you still see wrong widths.

---

## 12. One command: Figma to Bricks page, with a dataset (9 Oct 2026)

```powershell
node --env-file=.env scripts/pipeline.js "<figma-url-with-node-id>"                  # builds a NEW DRAFT page
node --env-file=.env scripts/pipeline.js "<figma-url-with-node-id>" --page 123       # writes into page 123
npm run pipeline -- "<figma-url-with-node-id>" --title "Jili home"                   # same thing through npm
```

`scripts/pipeline.js` runs, in order: 1 extract from Figma, 2 AI normalize, 3 compile (structure pass, responsive pass), merge and wrap, 4 push into the Bricks page (`4_inject_mcp.js --fix-keys`), 5 save the dataset. Output is streamed to the terminal and to `output/<frame>/runs/<timestamp>/run.log`; `run.json` in the same folder lists every step with its exit code and seconds, the page id and the arguments.

| Option | Meaning |
|---|---|
| `--page <id>` or `--title "<t>"` | target page; the default is a new draft titled "Figma import - <frame> <date>" |
| `--frame output/<name>` | skip stage 1 and use an existing frame folder (no URL needed) |
| `--no-inject` | build everything, leave WordPress alone |
| `--inject-partial` | push even if some sections failed (default: stop before WordPress and tell you to re-run) |
| `--force` | redo the AI step for finished sections (spends tokens) |
| `--only=a,b`, `--split=N` | passed to `run-sections.js` |
| `--no-dataset` | do not write the dataset |

Re-running the same command is safe and cheap: cached Figma data, assets and finished sections are reused. A failed section does not stop the others.

**Dataset** (`output/<frame>/dataset/`, rewritten by every run, or on its own with `node scripts/export-dataset.js output/<frame>`):
- `sections.jsonl`: one line per section with the exact model input (`prompt-figma.json`), the model's raw answer when saved, a rejected first attempt when there was one, the validated normalized JSON, and the compiled Bricks elements.
- `pairs.jsonl`: the same without the extras: `input`, `normalized`, `bricks_compiler`.
- `page.json`: Figma URL, WordPress page id, merged Bricks tree, template-import path, asset manifest.
- `screenshot.png`: the Figma screenshot.

**Capturing your hand fixes** is the most useful training signal. After you correct the page in the builder:

```powershell
node --env-file=.env scripts/export-dataset.js output/<frame> --page <id> --sync
```

This reads the page back from WordPress (`bricks/get-page-elements`, keep that ability enabled) into `wp-final.json`, and writes `human-diff.json`: per element, which settings you changed (before and after), plus elements you added or removed. Keep each run's folder; one run = one training example.

Notes: the pipeline needs the same `.env` as the individual stages (Figma token, model key, `WP_API_*`). `--sync` assumes `get-page-elements` takes `{ "postId": <id> }` and returns a list of elements; I could not test it against your site, so if it errors, send me the message.
---

# Structure rules (compiler improvement)

Why: the compiler output was structurally far from a hand-built Bricks page - single-child wrapper divs, rows of cards that were really
grids, decoration forced into the flow, offsets stored as 600px paddings, text boxes shrinking to content and sliding left. The fix is a
**deterministic, design-agnostic rule layer** that runs inside `structure-pass.js` (before `responsive-pass.js`). Every rule works from
Figma geometry (`figma-node.json`) plus the normalized tree - nothing mentions a section, a colour or a site.

## Files

| File | Change |
|---|---|
| `scripts/structure-rules.js` | **new** - the rules below |
| `scripts/structure-pass.js` | calls `applyStructureRules` first; your background / card / wrapper logic still runs after it |
| `scripts/3_compile_bricks.js` | passes Figma root + manifest; `--no-structure` (all off) or `--no-structure=grids,spanning` (named rules off) |
| `scripts/responsive-pass.js` | knows measured grids (width, columns per breakpoint, row gap), skips absolute layers, side margins/padding reset on small screens, centred full-width text keeps `width:fill` |
| `scripts/bricks-schema.js` | grid `_rowGap`, per-side borders, `_position:relative`, `_zIndex`, numeric icon width only, `&`/`<` escaping for heading/text-basic/button, `100%` width minus side margins |
| `tools/` | evaluation harness (renderer + metric) - see below |

## Rules (run order; each can be switched off by name)

| Name | What it does | Root cause it fixes |
|---|---|---|
| `hoist` | a section whose only child is a full-bleed filled group takes that fill, vertical padding and children | double-counted padding, extra full-width div |
| `dividers` | thin LINE/RECTANGLE/VECTOR on a parent edge becomes a one-sided border | `unsupported` lines dropped, no separators |
| `rebuild` | an `unsupported` node that holds text or pictures in Figma is rebuilt from Figma auto-layout / geometry | model gave up on real content (a whole "Cons" column vanished) |
| `missingText` | visible Figma text no element covers is re-inserted in the deepest container that holds it | dropped copy |
| `decoration` | pictures lying on a picture -> absolute layers; media that overlap, touch the edge, or hang outside their parent -> absolute; icon strips with huge offsets -> absolute | decoration forced into flow, 1180px margins |
| `wrappers` | same-flow flattening, pure-wrapper removal, single-wrapper absorption (only when placement is provably identical) | redundant divs |
| `grids` | rows of equal cards (and 2-D arrays of >=4) -> one CSS grid with measured columns/gap/row-gap | stacks of flex rows instead of grids |
| `spanning` | a card spanning its parent's content width says `fill` | cards shrinking inside `align:start` columns |
| `roles` | a title that is a heading in sibling cards is a heading everywhere | h3 / text inconsistency |
| `sanity` | text `justify` -> `text-align`; padding that cannot fit its own Figma box is corrected; margin/padding > 60% of parent removed | model-measured offsets, centred copy sitting left |
| `align` | a column whose children are centred on one axis gets `align:center` | blocks drifting to the left |

Every change is logged (`structure: ...`) so a run is auditable.

## Evaluation harness (`tools/`)

`render.py` turns a Bricks tree into HTML/CSS, screenshots it with Playwright at 1440 / 1024 / 390 and compares each Figma TEXT node to the
rendered element holding the same copy (tight rect, anchor follows `text-align`, per-section constant shift removed). It also reports
horizontal overflow per breakpoint. `build.sh` compiles + merges, `score.sh <label> [flags]` scores both frames, `rep.py` gives a per-section
report. Ablation: `for r in hoist rebuild decoration wrappers grids spanning; do tools/score.sh x_$r --no-structure=$r; done`.

## Results (1440px, mean absolute text-position error vs Figma)

| | v-2 frame | v1 frame |
|---|---|---|
| your pipeline before | 47.2 px x / 37.1 px y | 34.5 / 15.5 |
| this version | **10.8 / 7.3** | **6.6 / 6.8** |
| hand-made reference | 4.2 / 5.9 | |

Horizontal overflow at 1024 and 390: none on either frame (before: up to 605px wide on a 390px screen).

## What made "almost every layout" break

1. Grids were detected correctly but the wrapper around them took its width from the heading (351px), squeezing every card. `nodeWidth` now understands measured grids.
2. Centred, full-width text lost its width, so it shrank to content and sat left.
3. Blocks centred in Figma sat left because the parent had no alignment.
4. Pictures hanging outside the page edge stayed in the flow and pushed content.
5. A model-measured 666px padding stayed after the content it measured was dropped.

## Limitations (be honest)

- Measured on **one site, two frames**. Rules are geometry-based and not tied to it, but other designs may expose other cases - use the ablation switches to find them.
- The metric measures text position, not colours, fonts or images (images are placeholder boxes in the preview).
- Model-side faults are out of the compiler's reach: e.g. section-02 (hero) failed in `2_normalize` and needs `--force`/resume; text-only models drop content the `missingText` rule can only partly restore (5 of 209 texts still missing in the preview).
- The Bricks validator still lists `_width`/`_widthMax` on `text-basic`/`icon` as "never observed" - this warning is pre-existing and unrelated.
- Preview is an approximation of Bricks CSS; confirm in WordPress.

---

# Round 2 - hero, backdrops, icons, fills, strips (second test against the hand-made file)

Compared your compiled template with `hand-made.json` section by section. Every difference traced to one of these causes; each now has a
general rule (all switchable: `--no-structure=fills,assets,backdrop,fullBleed,...`).

| # | Your point | Cause | Fix (file) |
|---|---|---|---|
| 1, 2 | hero image outside the section, text below it | In Figma the hero is a *mask group*: a grey #D9D9D9 mask shape + the photo. The model copied the grey shape as a visible div and left the photo in the flow | `fills` removes a fill that is not visible in Figma / is placeholder grey under a covering picture; `backdrop` turns a picture that lies behind sibling content into the **section background image** (container raised above it) |
| 3 | curve line behind section 4 | The extractor skipped any group wider than 700px, so only the two 20px end dots were exported - the curve itself never existed in the data | `graphic-detect.js`: a group made only of vector shapes is one graphic up to 2400px; `backdrop` then makes it the wrapper's background (`size: contain`, centred - same as yours) |
| 4 | pros/cons: white headings, missing icons, odd sizes | A 30x30 icon frame has its white fill *switched off* in Figma; the model copied the colour onto the heading and dropped the icon. A 666px padding measured the dropped column | `fills` (checks every fill against visible Figma fills), `assets` (re-inserts icons/pictures no element covers, into the line they belong to), `sanity` (padding must fit its own box) |
| 5 | one grid for all items | Already merged by `grids`; the grid list now equals yours (11 grids, same columns and item counts) | `grids` |
| 6 | section padding | Your values were already right except where a section sits next to a *band* (background image or different fill): the whole gap belongs to the plain neighbour (hero 126/125, next 100/50, 8 -> 9 -> 10) | `merge_sections.js` |
| 7 | FAQ boxes fit content | A parent that aligns children to one side does not stretch them; the fill rule only handled `center` | `responsive-pass.js` (start/center/end), `spanning` (stack of equal cards without a Figma box) |
| 8 | footer line, pseudo-elements | Full-screen line: it was inside the 1200px container. Pseudo layers: not carried to tablet/phone, and a decoration layer was left in the flow (rendered top-left of the page) | `fullBleed` + `responsive-pass.js` (strip beside the container, container carries the side padding); responsive `_position:<bp>::before/after`; pre-placed layers pulled out even when a section has no Figma width |

## Numbers (same harness)

| | v-2 frame | v1 frame |
|---|---|---|
| before round 1 | 47.2 / 37.1 | 34.5 / 15.5 |
| after round 1 | 10.8 / 7.3 | 6.6 / 6.8 |
| after round 2 | **10.7 / 7.0** | **6.6 / 6.8** |

Text position barely moves in round 2 because round 2 is about *what is drawn* (backdrops, icons, fills, strips), which that metric does not see.
Checked by structure instead: grids equal the hand-made grids; hero has a section background image with the text on top; curve is a wrapper
background; footer strip is `width/minWidth 100%`; no horizontal overflow at 1024 / 390.

## Not verified / limits
- The curve case was tested on a re-created normalized input plus a stub asset - the SVG itself must be exported by re-running `1_extract_figma` (the rule change only decides what is exported).
- Hero in the real run still depends on the model emitting the photo as an image or section asset; `assets` recovers it if dropped.
- Pseudo-element visuals (`::before/::after`) could not be viewed in WordPress from here; I changed what is demonstrably missing (breakpoint position) and the stray layer.

---

# Round 3 - checked against your real run (page 3298)

Your run log + exported Bricks JSON showed the round-2 rules working (hero background image, 10 grids, footer strip, section paddings, pseudo-element
breakpoint keys). Remaining differences from `hand-made.json` and what changed:

| Seen in your result | Cause | Fix |
|---|---|---|
| "Conclusion" heading had a white background; one image had a white background + radius | A TEXT node's fill is its text colour, a picture's fill is the picture - the model copied them as backgrounds | `fills` removes backgrounds from text and picture leaves; text leaves lose `display:flex` / `justify` |
| First pros/cons card was a flex row (hand-made: grid) | One row of equal cards inside a padded/filled panel was not recognised | `grids`: such a row becomes a measured grid (grid list now equals yours: 11) |
| Rebuilt Cons rows had the icon after the text; padding 666px came back on the grid | Figma lists loose group layers in stacking order; padding-fit skipped grids | rebuilt rows sorted by position; padding-fit applies to grids |
| Curve line (section 4) still missing | Your section-05 was normalized *before* the curve was exported (`already normalized, skipping`), and the model called it "unsupported" | `rebuild`: an `unsupported` shape that is an exported graphic becomes that picture, then `backdrop` makes it the wrapper background |

**To get the curve in your pipeline:** copy the new `graphic-detect.js`, run `1_extract_figma` again (it now exports the curve group as one SVG),
then re-normalize only that section: `node scripts/run-sections.js output/<frame> --force` limited to `section-05` (or delete
`sections/section-05/normalized.json` and re-run). Old `normalized.json` files reference the two end-dot assets that no longer exist.

Harness after round 3 (text position, mean |dx| / |dy| at 1440): v-2 frame **6.7 / 6.0** (hand-made 4.2 / 5.9), v1 frame **6.6 / 6.8**; no overflow at 1024 / 390.

Still different from your hand-made file (not fixed, need your call): section 11 band padding 90 vs your 140; FAQ bottom 50 vs 100 and footer top 50 / bottom 50
vs 0 / 27 (you moved the whole gap to the FAQ); the second decoration layer (`::after` Mask-group) on the Conclusion card (Figma has one mask group,
your file has two layers); `text` vs `heading` tags on some copy.

## Round 4 - curve nested inside a decoration group

Page 3301 showed the section-4 curve exported correctly but left as an in-flow `image` (inside a group next to the end dot), so it pushed the cards down instead of sitting behind them. `backdrop` now also finds a wide SVG (>= 0.9 of the block width) anywhere below a sibling group, and when it lies behind the block's text it becomes that block's `_background.image` (`size contain`). Same rule, no design-specific ids.

## Round 5 - second site (CasinoFX) and what it showed

Run on a different design (`casinofx-homepage`, 14 top-level frames). Findings and the changes made:

| # | What happened | Cause | Change |
|---|---|---|---|
| 1 | Terminal showed only the `=== node scripts/2_normalize.js ... ===` header for 20-30 minutes, then all output at once | `run-sections.js` ran each step with `spawnSync` and piped output, so it was printed only after the step ended. A section with 19 parts waits ~65s between parts | `run-sections.js`: the model step now uses `stdio: "inherit"` and prints live (compile/merge output is still captured because the script counts `MISSING TEXT` in it) |
| 2 | Section-11 stopped: `stitched result failed validation ... must have required property 'text'` | The stitch added nodes from Figma data; one text element ended up with no copy | `2_normalize.js`: before validating, a text/heading/button without `text` is filled from the Figma node with the same id, else dropped, with a warning. A section is no longer lost for one empty element |
| 3 | `Spacing: no Figma geometry for these sections - kept the compiler's default padding.` (all sections got default padding) | `merge_sections.js` returned "no geometry" for the whole page when any one section had no Figma ids (here the four stray `Rectangle 9` frames, sections 05-08) | `merge_sections.js`: a section without geometry is skipped (and logged); the others are still measured |
| 4 | New `backdrop` case (curve nested in a decoration group) | The curve SVG sat two levels down beside an end dot, so it stayed an in-flow image | `structure-rules.js` (Round 4): a wide SVG (>= 0.9 of the block width) below a sibling group that lies behind the block's text becomes that block's background image (`contain`) |

### Not compiler problems
- **Sections 05-08 ("Rectangle 9", 412x140)** are stray frames in the Figma file. Delete them in Figma or run with `--skip=section-05,section-06,section-07,section-08`.
- **Groq daily token limit (200,000 per day, shared by all models).** When it runs out every model returns 429 and later sections fall back to Figma-data-only builds (no model styling, sometimes without the screenshot). Re-run only the incomplete sections with `--resume`; a paid tier or another provider removes the limit.
- **`examples/` is empty.** The model step logs `Loaded 0 example pair(s)`; corrected section pairs there reduce validation failures, retries and token use.

### Known open items
- `button._direction`, `_rowGap`, `_columnGap` are rejected by Bricks and renamed by the injector (`_flexDirection`, `_gap`, `iconGap`); the compiler should emit these keys itself.
- Icon `2214:65` (section-03) is not in the manifest; re-run extraction to export it.
- Section-11 was built partly from Figma data only (12 nodes added by the stitch, part 19b failed validation); groups reported as `skipped layout` stay flat.
- Spacing is measured only for sections that are built. A missing section (e.g. section-11 before it was built) makes the gap between its neighbours too large.

### Recommended workflow
1. Run the pipeline, then fix the page in the Bricks builder, correcting compiler mistakes only (not one-off taste).
2. Save the page, then: `node --env-file=.env scripts/export-dataset.js output\<frame> --page <id> --sync`.
3. Copy a few corrected sections into `examples/`.
4. Compare the corrected export with the original `merged/bricks-tree.json` to find missing compiler rules, and test each new rule on every site so far.
5. Save terminal output with `... 2>&1 | Tee-Object -FilePath logs\run.txt`.

## Round 6 - container width from Figma, and what the hand edits showed (CasinoFX page 3435)

Compared the compiled template with the hand-edited page, section by section. The structure was already close: 7 of 10 sections had the same elements in the same order; the 40% of edits were mostly values.

- **Container max-width was a constant (fixed).** `responsive-pass.js` used `SITE_WIDTH = 1200` for every section container, so a 1320px design got 1200px containers. The site width is now measured: `3_compile_bricks.js` takes the most common width of the page's top-level frames that are narrower than the page (and at least 600px) and passes it as `siteWidth`; `SITE_WIDTH` stays only as the fallback. On the first test design (frames of 1200 in a 1440 page) nothing changes; on CasinoFX it gives 1320. Not run on the CasinoFX files here (not available in this workspace) - check the section containers after the next compile.
- **Edits that are real compiler gaps (not done yet):** vertical alignment of columns (`align-items: center` set by hand on several rows), nav items that are buttons in the design but came out as `text-basic` (5 elements), a card's box-shadow / fixed height / background picture in the inspection cards, small paddings on pills and buttons, hover states and `<p>` wrapping of text.
- **Edits that are taste/Figma, not rules:** per-element hover states and custom CSS (`span { font-weight:600 }`), which are not in the Figma file.

## Round 7 - take more from the Figma frame (no model re-run needed)

Both rules run in `structure-rules.js` at compile time, so existing `normalized.json` files pick them up without calling the model again.

- **`figmaAlign` (rule name `align`)**: when the element's Figma frame has auto-layout, its cross-axis setting (MIN / CENTER / MAX) decides `align` if the children fit it. Geometry alone cannot tell start from centre for a single child or children as wide as the box, so the measured `start` used to win. On the first design this changes 27 elements; parent alignment now equals the hand-made file on 189 of 206 matched texts (was 176). The text-position metric moved by +2 texts over 8px (64 -> 66), so check results after compile.
- **`shadows`**: a visible Figma DROP_SHADOW on a frame that has a fill becomes the element's `boxShadow` when the model did not set one. The first design has no drop shadows, so this was tested only with an injected shadow (3 elements got it); check it on a design that has shadows (CasinoFX inspection cards).
- Switch off with `--no-structure=align` / `--no-structure=shadows`.

### Still not taken from Figma
- Fixed heights (the 200px inspection cards): Figma's height is a measured result, not always a setting. Not done.
- Nav pills as `button`: Figma has no button type; the nav items stay `text-basic`.
- Hover states, custom CSS, `<p>` text wrapping: not in the Figma file.

## Round 8 - CasinoFX run (real Figma data)

I compiled the 10 CasinoFX sections you attached (`figma-node.json` + the `normalized.json` files) with the current compiler and compared the result with your edited page. Four more things that are in Figma were being lost. All four are general rules in `structure-rules.js` (switch off with `--no-structure=<name>`):

| Rule | What it does | Where it showed |
|---|---|---|
| `separators` | A thin LINE between two siblings (the `\|` between footer links, rules between ranked rows) becomes a border on the next sibling: 1px colour from the line, padding = the Figma spacing after the line. Also finds lines the model left out entirely (Figma line 2236:41 "Expo"). Needs equal spacing before and after the line. | footer links, leaderboard rows |
| `figmaSpacing` (under `align`) | Gap and left/top padding of a frame come from its Figma auto-layout `itemSpacing` / padding, but only when the rendered boxes agree with that value. | footer link rows 36 -> 18, a rank badge padding 0 -> 6 |
| `pills` | A frame that only wraps one text and shrink-wraps it (tag, badge, pill, number chip) becomes that text with background, padding and radius, so there is no extra div. Not applied when the text is centred or stretched inside a wider frame, or when it has a link/image. | 22 elements on CasinoFX (PAGCOR tags, AD badges, rank numbers) |
| line gap | `measureFlow` and `figmaSpacing` ignore the space a separator owns when they measure the gap | footer |

Checked: the first design scores the same as before (texts 204/209, mean error 6.7/6.4 px), no horizontal overflow at 1024 or 390.

Not done, and why:
- Nav "pills" as buttons: your edited page keeps them as text in a div, so there was nothing to copy.
- `margin-left` 137/139/144 on the AD badges is a model value tied to its flow guess; it is not a Figma property.
- Hover colours, custom CSS (`span` weight) and fixed card heights are not stored in Figma data.
- Footer separators are borders on the link, so they are as tall as the link (24px) instead of Figma's 15px.
- Icon 2214:65 is missing from the asset manifest: that is the extract step, not the compiler.

## Round 9 - `--estimate` (know the token use before calling the model)

`node scripts/2_normalize.js output/<frame> --nodes=<id> --name=section-NN --split=5500 --estimate`

Builds exactly the prompts the run would send (same pruning, same parts), prints the number of model calls, input tokens, output tokens and a worst case with one repair call per part, then exits. Nothing is sent to any provider, so it costs nothing and needs no working key. The output size is measured from the section's existing `normalized.json` (or `normalized.rejected.json`) when there is one; otherwise it is guessed. Put `PRICE_IN_PER_MTOK` and `PRICE_OUT_PER_MTOK` (the model's dollar prices per million tokens) in `.env` to get the cost in dollars. Screenshots, if the run sends one, add roughly 1,500 input tokens each and are not counted in split mode.

Anthropic keys that are not scoped to a workspace are refused with "must include the anthropic-workspace-id header". Either create the key inside a workspace in the console, or set `ANTHROPIC_WORKSPACE_ID=<id>` in `.env`; `2_normalize.js` then sends it as the `anthropic-workspace-id` header.

With the Anthropic provider, each model call now prints the tokens the API reports (input/output), the running total for the run and, if `PRICE_IN_PER_MTOK`/`PRICE_OUT_PER_MTOK` are set, the cost so far.

## Round 10 - paid model gave the same layout: two compiler faults, fixed

Running section 12 with the paid model (all 10 parts accepted, no part rebuilt from Figma only) gave the same layout problems as Groq. So the cause is in the compiler's layout handling, not in the model. Two were found on your section-12 export and fixed with general rules:

| Rule | Fault | Fix |
|---|---|---|
| `badges` (inside `backdrop`) | A small group of one shape + one number (rank badge) became a block as wide as the digit (8px) with the shape as a background that was squashed into it. In the first card the badge also left a 67px margin on the name below it. | The block takes the shape's Figma size (47x42), the number is centred in it, and the gaps in the parent column are measured again. All six cards now have the same 13px / 12.5px gaps as in Figma. |
| `cardPictures` | In the article cards the picture came after the text in document order, and the card used a 200px top padding to leave room for it. | The picture becomes the first child of the card, the padding is cleared, and the text goes in an inner block that keeps the side padding. Same structure as the other cards. |

Switch off with `--no-structure=badges` is not available (it runs with `backdrop`); `--no-structure=cardPictures` turns the second off. The first design scores the same as before (texts 204/209, mean error 6.7/6.4 px).
