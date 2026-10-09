# Figma → Bricks: SOP and README

Last updated: 9 Oct 2026. Project: `C:\figma-to-bricks`. Target site: `casinodesign.bcit.in` (Bricks 2.4.2, WordPress 7.1.2, MCP Adapter 0.6.1).

This document covers how the pipeline works, how to run it, how the Bricks MCP route works, every problem found so far and how it was fixed, and what is still open.

---

## 1. How the pipeline works

```
Figma file
  1_extract_figma.js      → output/<frame>/figma-node.json, screenshot.png, assets/        (deterministic)
  2_normalize.js          → sections/<name>/normalized.json                                (AI model + deterministic post-processing)
      └ normalize-postprocess.js  measures sizes, gaps, padding, alignment from Figma geometry
  3_compile_bricks.js     → sections/<name>/bricks-tree.json                               (deterministic)
      └ bricks-schema.js, responsive-pass.js
  merge_sections.js       → merged/bricks-tree.json                                        (deterministic)
  wrap-template.js        → merged/bricks-template-import.json (manual import file)
  4_inject_mcp.js         → pushes the tree into WordPress through Bricks abilities (MCP)
  4_inject.js             → OLD route (REST + postmeta). Kept, untouched.
  run-sections.js         → runs stages 2 + 3 for every section, then merge + wrap
```

**Rule of thumb for debugging:** stages 1, 3, merge and the post-processing are deterministic code, so the same input always gives the same output and bugs there are fixed in the scripts. Only the model step in stage 2 is AI, and its output can differ between runs.

### Who caused a problem? (AI or compiler)

| Symptom | Look at | Usually |
|---|---|---|
| Wrong colour, border, spacing, width, huge gap, wrong key name | `normalized.json` first. If the value is already wrong there and came from "measured from Figma", it's the post-processor. If it's correct there but wrong in `bricks-tree.json`, it's the compiler. | Compiler |
| Elements grouped wrongly, text outside its card, missing elements | Console log of stage 2: "layout nesting did not match", "built from Figma data alone", "missing from the model's parts" | AI (model) or the grouping step |
| Model answered with a different model / TEXT-ONLY | Console log: "rate limited (429)", "TEXT-ONLY - screenshot dropped" | AI quality drop from rate limits |
| Key rejected on save | `4_inject_mcp.js` error `Invalid value for "settings.X"` | Compiler emitting a key Bricks doesn't know |

---

## 2. One-time setup

1. Node.js 20.6 or newer (`node -v`). Run `npm install` in the project.
2. Create `.env` in the project root (never commit it, add it to `.gitignore`):
   ```
   WP_API_URL=https://casinodesign.bcit.in/wp-json/mcp/mcp-adapter-default-server
   WP_API_USERNAME=<the WordPress username that created the application password>
   WP_API_PASSWORD=<application password, 24 characters in groups of four>
   ```
   plus the existing Figma token and model keys the stage 1 and 2 scripts already use.
3. In WordPress: Users → Profile → Application Passwords → create one named for this tool. Use a **dedicated limited user** if possible, and a **staging site**. Revoke the password when you stop using it.
4. In Bricks → Settings → AI → Abilities, set the abilities as in section 4.
5. Apply the compiler fixes once: `node scripts/apply_fixes.mjs` (see section 6). It makes `.bak` copies and can be run again safely.

**Credential hygiene:** a password and an app password were visible in screenshots during setup. Anything that appeared in a screenshot or chat should be treated as exposed: change the real account password, and revoke and recreate application passwords.

**PowerShell notes** (the VS Code terminal here is PowerShell):
- `set X=...` does nothing in PowerShell. Use `.env` with `node --env-file=.env ...`.
- `@file.json` must be quoted: `'@args.json'`.
- Inline JSON with double quotes gets mangled, so pass a file instead.

---

## 3. Everyday workflow

```powershell
# 1. Stage 1 (only for a new or changed Figma page). Use the Figma URL that includes the node id.
node scripts/1_extract_figma.js "<figma-url-with-node-id>"            # add --dry-run to use the cached figma-node.json with zero Figma API calls

# 2. See the plan without running anything (each section: done / to do)
node scripts/run-sections.js output/jilislot-global --dry-run

# 3. Normalise + compile every section that is not done yet, then merge and wrap
node scripts/run-sections.js output/jilislot-global                   # or --only=hero,section-07 for just some sections

# 4. Push to WordPress as a NEW DRAFT page (renders first, then saves)
node --env-file=.env scripts/4_inject_mcp.js output/jilislot-global/merged --fix-keys --title "MCP Test - <name>"

# 5. Re-run into the same page
node --env-file=.env scripts/4_inject_mcp.js output/jilislot-global/merged --fix-keys --page <postId>
```

**Do not use `--force` casually:** it deletes a section's saved `parts/` and redoes the model step, which spends tokens and can change the result.

`run-sections.js` skips the model for sections that already have `normalized.json`, so a re-run is free. To regenerate one section without new model calls, use `--resume` (it reuses saved `parts/`):

```powershell
node scripts/2_normalize.js output/jilislot-global --nodes=<figmaNodeId> --name=<section> --split=4600 --resume
node scripts/run-sections.js output/jilislot-global
```

Watch the console: any "Calling LLM" line means tokens are being spent. A section that was never split has no `parts/` folder, so a re-run costs one call.

**Rate limits:** the model provider enforces a daily token cap. When it is hit, work falls back to smaller text-only models, which lowers quality. Avoid unneeded `--force` runs.

---

## 4. Bricks MCP route

**What it is:** the WordPress MCP Adapter exposes Bricks "abilities" (170 on this site). `4_inject_mcp.js` talks to it directly with JSON-RPC and the application password. No AI client is involved, so the result is deterministic.

**What the script does:** connects → uploads local assets through WordPress's core media endpoint (cached in `output/mcp-media-cache.json`) → creates a draft page (or uses `--page`) → `render-elements` check (nothing saved; HTML+CSS go to `output/mcp-render-<name>.html`) → `set-page-elements` (Bricks takes a revision first and prints its id) → regenerates CSS files if allowed.

**Flags:** `--page <id>`, `--title "..."`, `--no-assets`, `--render-only` (needs `--page`), `--fix-keys`.

**`--fix-keys`:** Bricks validates every setting key on save. When it rejects one and says "did you mean X", this flag renames the key in memory and retries, and writes a patched copy to `output/mcp-fixed-tree-<name>.json`. It never edits your original tree. It is a stop-gap: the real fix belongs in the compiler.

**Test tools:** `scripts/test-mcp.mjs` connects, lists abilities, saves schemas, and runs one ability: `node --env-file=.env scripts/test-mcp.mjs run <ability> '<json>'` or `'@file.json'`. Results go to `output/`.

### Abilities: what stays on, what is off

Keep enabled for this workflow: `create-post`, `set-page-elements`, `render-elements`, `upload-media`, `find-media`, `restore-revision`, `list-revisions`, `get-page-elements`, `get-element-schema`, `list-element-types`, `list-breakpoints`, `get-mcp-version`, `list-ability-status`, `find-post`, `regenerate-css-files`.

Switch off (nothing here needs them and each can damage the site): every `delete-*`, `set-global-settings`, `set-style-manager`, `set-breakpoints`, `set-pseudo-classes`, `set-reading-settings`, `import-transfer-package`, `commit-site-foundation`, `run-woo-setup`, `cleanup-orphaned-elements`, `resolve-site-changeset`, and `execute-php` (already off by default; verified disabled).

Check status any time: put `{"abilityNames":["bricks/execute-php"],"includeDisabled":true}` in `args.json` and run `run bricks/list-ability-status '@args.json'`.

### Undo
`set-page-elements` prints a `revisionId`. Restore it with the `bricks/restore-revision` ability. A page the script created is a draft, so deleting it in WordPress is also fine.

### Site facts used by the compiler
Breakpoints: desktop 1279, tablet_portrait **1024** (changed from Bricks default 991), mobile_landscape 767, mobile_portrait 478. Check tablet layouts at 1024.

---

## 5. Problems found and how each was solved

| # | Problem | Cause | Fix | Status |
|---|---|---|---|---|
| 1 | Old injection depended on a helper plugin exposing postmeta | Fragile REST route | `4_inject_mcp.js` via Bricks abilities | Done, works |
| 2 | Env vars "not set" | Using the old script, PowerShell `set` does nothing, `.env` not read | `--env-file=.env`; script also reads `.env` itself | Done |
| 3 | `set-page-elements` disabled | Ability off in Bricks settings | Enabled it | Done |
| 4 | Save rejected: `button._direction` | Compiler emits layout keys Bricks doesn't accept on buttons | `--fix-keys` renamed `_direction`→`_flexDirection`, `_rowGap`→`_gap`, `_columnGap`→`iconGap` | **Open**: these are Bricks' suggestions, not verified. `iconGap` may only space icon and text. Check the button visually, then move the verified keys into `bricks-schema.js` |
| 5 | Page background missing: white text on white | Figma root frame fill (`#000000`) was never read; sections have no fill of their own | `merge_sections.js` applies the root fill to sections without their own background | Fixed by `apply_fixes.mjs`, tested on 6 sections |
| 6 | Border had no "solid" | `bricks-schema.js` wrote width and colour but not `style` | adds `style: "solid"` | Fixed, verified in compiled output |
| 7 | Huge row gaps (294, 331, 428, 526, 631 px) | Post-processor turned the measured distance between items at opposite ends into a fixed gap | Such rows become `space-between` and keep their width (Figma auto-layout `SPACE_BETWEEN`, or a wide even gap ≥120px that is more than twice the smallest item) | Fixed for header nav in tests. Re-run stage 2 for header and FAQ (section-19) to apply |
| 8 | Card and its text in different divs (Conclusion, section-18) | The card is a GROUP of shapes (rectangle + mask + decorative vector), not a bare rectangle. Only a bare rectangle counted as a background, so the text frame overlapped it, layout was skipped, and the shapes became their own div with offsets turned into 805px padding | A shapes-only group covering its parent now collapses to its full-size rectangle, which becomes the parent's background; decorative shapes stay out of the flow | Fixed in the measured tree. Tested on all 20 sections: only section-18 changed. Re-run section-18 with `--resume` |

Side effect to remember: with the page background now black, text that sits outside its card (black text meant for a yellow card) becomes invisible. Problem 8's fix puts that text back inside the card.

### Quality limits that come from the AI step
- Some parts failed validation and were rebuilt from Figma data only, losing frame backgrounds and borders: section-09 (part 12), section-12 (part 4), section-16 (part 4). Check these visually.
- When daily limits are hit, text-only models are used and can't see the design.
- `examples/` is empty ("Loaded 0 example pair(s)"). Adding two or three verified pairs (for example hero and section-08) is the biggest AI-side improvement. See `examples/README.md`.

---

## 6. Applying and checking the compiler fixes

```powershell
node scripts/apply_fixes.mjs --check    # report only
node scripts/apply_fixes.mjs            # apply (makes <file>.bak, safe to re-run)
```

Each edit only applies if the exact old text appears exactly once. If your file has changed, that edit is skipped and reported, and nothing is guessed. After patching, regenerate:

1. Sections whose layout changes: header (`--nodes=8221:6 --name=header`), section-18 (`--nodes=8226:543`), section-19 (`--nodes=8226:585`) with `--split=4600 --resume`.
2. `node scripts/run-sections.js output/jilislot-global` (compile + merge, no model calls for finished sections).
3. Inject into a new draft and review.

---

## 7. QA checklist before calling a page done

- [ ] Render check passed (element count in `render-elements` roughly equals the tree)
- [ ] No failed asset uploads (SVGs can be blocked by WordPress; enable SVG uploads or ask for a fallback)
- [ ] Compare each section with Figma at desktop, tablet (1024) and mobile
- [ ] Section backgrounds, borders, button spacing, heading sizes, text widths
- [ ] Text is readable on its background (watch for black text on black)
- [ ] Check the sections listed in "Quality limits that come from the AI step"
- [ ] Nothing was written to a live page; the target is a draft

---

## 8. Open items

**Before launch**
- Verify the button keys from problem 4 and bake them into the compiler.
- Visual pass on sections 09, 12, 16 (styling lost to model failures) and on any section the post-processor warned about ("skipped layout").
- Re-run header, section-18, section-19 after applying fixes.

**After launch**
- Decorative offsets: a few items positioned by large padding or margin (for example an icon with a 1180px left margin in `why-jili`, from freely placed Figma layers). Needs an absolute-position or "skip decoration" rule.
- Line/divider elements are skipped as `unsupported`; map them to a border or divider.
- Section-level `execute-php`, delete abilities and other risky abilities should stay off.
- Add verified example pairs to `examples/`.
- Replace per-section background fill with a single page/theme background once the right Bricks setting key is confirmed.

---

## 9. Troubleshooting

| Message | Meaning and fix |
|---|---|
| `Missing: WP_API_...` | Run with `--env-file=.env` from the project root and check `.env` |
| `HTTP 401` or `403` | Username must be the account that created the app password |
| `ability ... is disabled` | Enable it in Bricks → Settings → AI → Abilities and save |
| `Invalid value for "settings.X"` | Bricks doesn't know the key. Re-run with `--fix-keys`, then fix the compiler |
| `Cannot auto-fix ...: no replacement suggestion` | Send the element type and key; the compiler needs a mapping |
| Render warns far fewer elements than the tree | Some elements are invalid or dropped; don't save, inspect `output/mcp-render-*.html` |
| `Cannot find package 'ajv'` | Run `npm install` |
| "rate limited (429)" | Daily model limit. Wait, or use `--resume` so finished parts are not re-requested |
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