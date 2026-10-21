# Session handoff — Figma-to-Bricks clean-build audit

Saved on 2026-10-16 at the user's request before the session limit. **The user deliberately stopped the audit. Resume from this document; do not assume the audit is finished.**

## Objective and current status

The user wants the compiler/pipeline to reproduce all agreed layout and menu behavior after deleting `output` and starting again. Fixes must live in reusable source code, not manual WordPress edits or saved normalized JSON/binding files.

Initially there were seven designs. The user explicitly said **skip CasinoFX and LaslesVPN for now** after CasinoFX returned Figma 404 and LaslesVPN lacked a source URL and required mask exports. The active scope is now five designs:

1. Jili original
2. Jili V2
3. Match Plus
4. Personal portfolio (`landing-page`)
5. PG Slot

**Compiler regression is now clean, but actual Bricks frontend verification is still required before promising bug-free output.** All five passed the same fresh deterministic build on 2026-10-21 and the complete automated suite passes. No pages were published or injected in this audit.

## 2026-10-21 continuation checkpoint

- Fixed repeated portfolio service-card sizing in `figma-preservation.js`: card-sized background panels retain their measured width while full section backgrounds still remain fluid.
- Fixed external slider pagination in `native-components.js`: an aligned strip of at least three small circular or rounded-pill controls can sit beside the slide row, is removed from ordinary content, and becomes native pagination. Portfolio now emits `pagination:true`, `arrows:false`, measured 57x16 pagination controls, and three native slides.
- Extended source header-menu discovery through one-label wrapper frames. The menu plan selects those direct wrappers, keeps the logo and CTA, and creates a WordPress menu configured to switch at 1024px.
- Added focused regression tests for all three behaviors.
- `npm.cmd test`: **85 passed, 0 failed**.
- Final consistent clean build: `.review-work/clean-regression-1792554925396`; all five active designs PASS.
- Final local preview report: `.review-work/clean-regression-1792554925396/preview-report.json`. Both Jili designs and portfolio have zero horizontal overflow and zero broken images at all measured widths. Match reports 420px at 390; PG reports 1136px at 390/1024. The overwide nodes are their uninitialized native slider children (Match 404px slides, PG 1120px slides). This local renderer does not initialize Splide or provision WordPress menus, so do not treat those measurements as live Bricks widget failures.
- Remaining acceptance step: import/inject the new templates into reversible WordPress drafts and inspect actual Bricks frontend behavior for native sliders, menus, FAQ, and visual fidelity. Do not claim frontend certification from the local preview.

## Working constraints

- Workspace: `C:\figma-to-bricks`; PowerShell; use `npm.cmd`.
- Do not delete existing outputs. Audit builds are under `.review-work`.
- Do not expose `.env` contents or credentials.
- Do not use PHP edits or assign global WordPress theme menu locations.
- No subagents unless explicitly authorized by user/instructions.
- The user wants action in the pipeline, not manual per-design setup scripts.
- Preserve user changes; the checkout contains many modifications from previous work.
- Browser/local previews are approximations, especially for native Bricks menus, sliders and accordions. They do not execute Bricks frontend JS.
- If consulting memory, the memory registry is `C:\Users\LENOVO\.codex\memories\MEMORY.md`; follow the session's memory citation rules. This README is a workspace handoff, not a memory update.

## Source URLs and folders

Omit `&t=...` from commands. Windows `npm.cmd` previously split that tracking parameter and printed `'t' is not recognized`.

| Design | URL | Current useful source folder |
|---|---|---|
| Jili original | `https://www.figma.com/design/9ZC7Ja7QmEw4bpH7ue8zdC/Online-Betting-Website?node-id=8219-29` | `output/jilislot-global-0d6791f8` (fresh extraction this audit); old `output/jilislot-global` retained |
| Jili V2 | `https://www.figma.com/design/9ZC7Ja7QmEw4bpH7ue8zdC/Online-Betting-Website?node-id=8232-2` | `output/jilislot-global-v-2` (missing mask and changed SVG grouping re-exported successfully) |
| Match Plus | `https://www.figma.com/design/npzLbyeDKUPIddvso2Kz3W/Matchplus?node-id=32-1096` | `output/match-plus-home-07978f5e` (fresh extraction); old `output/match-plus-home` retained |
| Portfolio | `https://www.figma.com/design/4wF81rXzm2dJqTSIKbNuJe/Portfolio?node-id=260-49` | `output/landing-page` (three composite PNGs and changed SVG groups exported successfully) |
| PG Slot | `https://www.figma.com/design/QWeNLqVxWvyzYENYnMrvBk/Online-Betting-Website-2--Copy-?node-id=202-12` | `output/pgslot-thailand-com-84cdd226` |
| CasinoFX — skipped | `https://www.figma.com/design/mMJsY2EiHFk4VaFghaUh4L/CasinoFX-Homepage?node-id=2214-2` | `output/casinofx-homepage`; current token returned 404 during SVG export |
| LaslesVPN — skipped | Source URL not supplied | `output/landingpage`; required masks missing, including `1:476` and `1:137` |

Fresh extraction created hashed directories when legacy folders lacked file-key identity. This is intentional; do not bypass file-key-aware cache safety. CasinoFX's failed extraction may have updated planned/partial manifests; old asset files were not deleted.

## User-agreed behavior to preserve

- Header content stays in a row; header navigation becomes hamburger at 1024px.
- Hamburger must be interactive native control, not three decorative divs.
- Home/download/separator toolbar items center vertically.
- WordPress menus are created/reused by the pipeline; missing destinations may be `#`, Home the site root. Existing edited destinations must survive reruns.
- Footer headed lists become WordPress menus, never hamburger. Footer flex rows wrap on tablet; grids halve columns on tablet and become one column on mobile.
- Card content belongs in a padded body, not repeated left margins. Claim Now headings align with the description/buttons, including desktop. Tablet body side padding is 20px.
- Side padding over 20px caps at 20px at/below 1024px.
- Large measured row gaps become fluid max-width + width 100% + space-between when geometry supports it.
- Content images max-width 100% at tablet; preserve small logos/icons and intentional layered artwork.
- Layered phone/oval artwork should export as a composite where appropriate, not separate flow images.
- Sliders must not invent arrows; replace measured dot artwork with native pagination.
- PG FAQ: six items, five empty answers plus the one real source answer. Do not invent answer copy.
- Equal-background section gaps split half/half. Different backgrounds retain the full measured gap on one side, preferably the page-background side; neither matching -> following section top. Do not double total gap.

## Earlier completed pipeline work (before this audit)

- `scripts/pipeline.js` now runs `setup-pipeline-menus.js` after compilation, then remerges, wraps, validates, injects. `--no-inject` skips remote menu creation.
- `scripts/pipeline-menus.js`: discovers menus, provisions via WP REST, applies generic header menus.
- `scripts/setup-pipeline-menus.js`: WordPress credentials from environment, legacy binding adoption, writes site-aware `wordpress-menus.json`, `footer-menus.json`, updates `menu-controls.json`.
- Fixed `400 menu_exists`: lookup by slug and exact name; recover the creation race; persist WordPress's returned slug. Preserve edited links.
- PG existing WP menus: header ID22, footer IDs23/24. Menu stage was verified live successfully before this audit.
- `scripts/content-spacing.js`: shared card margins -> padded body; existing narrow Claim Now body wrappers expand below1024; headings align left when body copy does.
- `scripts/section-gap.js` + merge integration: backgrounds applied before gap calculation; whole-gap behavior described above.
- Other established modules: `menu-controls.js`, `footer-menus.js`, `responsive-padding.js`, `responsive-content.js`, media cache verification, composite/mask export repairs, source layout repair, native slider/accordion handling.
- Latest published PG page from user: `https://casinodesign.bcit.in/figma-import-pgslot-thailand-com-84cdd226-2026-10-16-2/`. Previous attempts to update page3931 hit a Bricks editor lock. Do not take over that lock or claim candidate changes were deployed.

## Changes made during THIS audit

### Reproducible audit tools

- `tools/clean-regression.mjs`: creates an isolated directory and copies **only extracted source/metadata/assets manifest**, with asset paths pointing to existing files. It does NOT copy normalized JSON, section maps, menu bindings, or patched compiled trees. Runs pipeline `--deterministic --no-inject --no-dataset`. Optional positional folder names restrict the set. Writes per-design `clean-build.log` and aggregate `report.json`.
- `tools/clean-preview.mjs <audit-dir>`: creates local approximate desktop/1024/390 screenshots and metrics via `scripts/preview.js`. Writes `preview-report.json`. Native JS behavior is NOT represented accurately.
- `tools/audit-extraction.mjs`: fixed list of four extraction URLs for this audit. It stopped on CasinoFX404 before the portfolio; portfolio was then extracted separately. **Do not rerun this blindly: CasinoFX is now skipped.**

### Source-driven context, independent of saved output

- New `scripts/source-menu-context.js` detects short aligned header labels near top, three-bar hamburger geometry, nearby logo, footer names/list structures. `annotateMenuContext` tags source-map entries and returns cross-section hamburger bindings.
- `merge_sections.js` now derives those bindings when no `menu-controls.json` exists; records unbound `merged/menu-source.json` before widget transforms.
- PG auto-detection correctly returns trigger202:22, logo202:21, header202:15, content250:7, navigation250:8, breakpoint1024.
- Footer context also marks bottom ancestors, allowing footer responsive wrapping on fresh normalization.
- `pipeline-menus.js` skips duplicate nested menu discovery. Mixed headers now create a menu child around selected text members, **preserving the logo and CTA**, instead of replacing the entire header. Added regression test. Still inspect generic detection completeness: portfolio links are wrapped in individual frames and currently may not be discovered; Match Plus's Services dropdown may not be included by the direct-text-only detector.

### FAQ

- New `scripts/source-faq.js`, invoked from `repairSourceLayout`, finds explicit FAQ heading plus >=3 question rows and constructs native-compatible title/content wrappers. Keeps source answer text; missing answers empty. Opens the first item with real answer, otherwise no explicit open index.
- Verified fresh PG build has six accordion items, five-slide slider, native hamburger/offcanvas, and discovers header + two footer menus without saved bindings.

### Compilation/geometry fixes

- `structure-rules.js` `recoverMissingAssets`: initialize `host.children ||= []` before `.find`/`.splice`. Clean builds of Jili and portfolio previously crashed here.
- New `scripts/site-width.js` used by both deterministic normalization and compilation: use wide centered source boxes, prefer top-level evidence, shallow descendants as fallback. Prevented Match Plus selecting a repeated622px column instead of1276px container. PG remains1120px.
- `run-sections.js`: non-rectangular painted BOOLEAN_OPERATION/VECTOR backgrounds are grouped with covered content, instead of becoming empty sections and producing false missing-text failures.
- `run-sections.js`: top-level loose nodes connected by vertical overlap now share one section. This is crucial for Match Plus hero copy beside illustration and loose card rows. Backdrop ownership is transferred to the combined section. These changes are broad: regression-test them carefully.
- `figma-preservation.js`: when XY cut fails, expand overlapping unpainted logical GROUP wrappers (or synthetic wrappers) using child bounds before pinning a whole section. Work on cloned children so failed attempts don't destroy original positioning. This changed Match Plus footer from a fixed absolute canvas to flowing rows.
- `figma-preservation.js`: repeated solid rectangular panels containing >=2 children including text are grouped into inferred card containers before conversion. Intended to attach portfolio service card backgrounds to content instead of leaving them pinned at desktop x coordinates.
  - **Outstanding:** inferred panel wrappers may need explicit measured width (`out.size.width = parentBox.width` for `_inferredPanel`) because they aren't in the original raw map during later reconciliation. Latest desktop portfolio preview showed unequal/narrow service cards. This was the next investigation, not yet fixed.

### Responsive final pass

- `responsive-content.js` now accepts raw root as third argument from merge.
- Header native menus get explicit custom1024 breakpoint/max-width100%.
- Non-navigation text can shrink/wrap below1024 instead of `_flexShrink:0` overflowing FAQ rows.
- Full-width header source padding can subtract measured page inset after the container already provides that inset.
- Pinned text compositions become flowing at tablet; pinned nontext coordinates/widths become percentages of source parent width. This eliminated several mobile overflow cases but still needs visual scrutiny (no blanket clipping used).
- **Do not equate zero horizontal overflow with visual fidelity.**

## Test and audit evidence

`npm.cmd test` last fully observed success: **80 tests passed** before the latest grouping/pinned-layout additions. A subsequent test run was still tracked as exec session57983 when interrupted; poll it or simply rerun the suite. New tests include `tests/clean-source.test.js` and changes to `pipeline-menus.test.js`.

Audit directories, oldest to newest:

- `.review-work/clean-regression-1792148026064`: initial seven-design run; crashes/missing masks.
- `.review-work/clean-regression-1792148220269`: second run, stale asset coverage and initial visual previews. Do not use as final output.
- `.review-work/clean-regression-1792148724461`: fresh Jili/Match/PG; Match initially failed false missing-text check on painted Union.
- `.review-work/clean-regression-1792148794290`: portfolio after new asset exports, before later card geometry fixes.
- `.review-work/clean-regression-1792148919312`: **all five selected designs report PASS** in clean deterministic build. Some subsequent merges updated responsive settings but normalization predates the newest footer/card changes. Thus not the final consistent snapshot.
- `.review-work/clean-regression-1792149080771`: latest clean builds for **portfolio + Match Plus**, both PASS. This includes loose panel/footer grouping changes, with subsequent remerge for newer responsive pass. Most useful current visual investigation folder.

Latest preview measurements:

- Jili original + V2 (`1792148919312`): no horizontal overflow at390/1024/1440, zero broken images in local preview.
- Portfolio (`1792149080771` after remerge): no horizontal overflow at390/1024/1920, zero broken images. **Desktop visual issues remain**, especially service card sizing and local preview of slider. Native slider renders as stacked children locally, so do not infer its actual frontend behavior from that alone.
- Match Plus (`1792149080771`): no overflow at1024/1728;390 scrollWidth420. The overwide element is native slider `erzu7i` with404px slides; local preview doesn't initialize Splide. Need constrain outer slider width and verify actual Bricks rendering before deciding whether slide width itself is a live bug.
- PG latest five-design preview run was still running as session8870 at interruption. Poll or rerun.

Reference overview screenshots inspected for all seven designs are `.review-work/<original-folder>-overview.png`. Local resized candidate images include `.review-work/landing-page-clean.png` and `.review-work/match-plus-home-07978f5e-clean.png`. **These filenames may be stale relative to latest merge**; prefer full PNGs in each audit `preview/` directory.

## Exact remaining work / suggested continuation

1. Read this document, inspect current files/diffs, and confirm outstanding processes. Do not restart the whole task blindly.
2. Finish focused source fixes:
   - inferred repeated panel widths / equal card layout in portfolio;
   - generic header detection for label wrappers and dropdown labels, without swallowing logo/CTA;
   - native slider outer responsive width, and measured pagination controls outside slide rows (portfolio has external dots; current native slider settings had `pagination:false` despite Figma dots);
   - inspect Match Plus fresh source vs screenshots. Some live-fetched source differs from older screenshot content. Local preview showed duplicate-looking sections; determine whether this is genuinely in source or bad grouping/preview before changing it;
   - preserve header rows and footer menu behavior on all five, not merely PG.
3. Add targeted regression tests for new section-band grouping, inferred panels, and pinned-layout behavior. Existing suite may pass while these remain visually wrong.
4. Run a final clean five-design regression with current source code and complete assets:

   ```powershell
   npm.cmd test
   node tools/clean-regression.mjs jilislot-global-0d6791f8 jilislot-global-v-2 match-plus-home-07978f5e pgslot-thailand-com-84cdd226 landing-page
   node tools/clean-preview.mjs .review-work/clean-regression-<new-stamp>
   ```

5. Inspect desktop/tablet/mobile screenshots against Figma. Local preview is useful for geometry, not native interaction certification. For native render verification, existing helpers `tools/pgslot-render-candidate.mjs` and `tools/pgslot-frontend-check.mjs` demonstrate read-only Bricks rendering and isolated candidate injection into a browser. They currently contain PG-specific paths/selectors; do not call them for another design without adapting them.
6. Verify menu planning on **unbound** `merged/menu-source.json` and no cached bindings. `--no-inject` intentionally doesn't provision WordPress menus. Any full-injection tests should use reversible drafts, not overwrite locked published pages.
7. Produce a concise honest final audit report with per-design status and limitations. **Do not claim all designs are bug-free or visually verified based only on clean-build PASS.** User plans to delete output; advise retaining a backup until extraction + actual frontend verification are complete.

## Process state at interruption

Most long runs had completed. Potentially still relevant unified exec sessions:

- 57983: latest `npm.cmd test` (last partial output, no final result observed).
- 8870: `clean-preview.mjs .review-work/clean-regression-1792148919312` (four designs printed, PG pending at last poll).
- 92541: older Match Plus `run-sections --force`, probably completed but not polled to completion.

Completed: extraction session92060 (ended CasinoFX404); portfolio extraction56343; clean five-design14813; latest pair64091; pair preview78944.

During handoff, OS process enumeration via `Get-CimInstance Win32_Process` was denied by sandbox. No broad process termination was attempted. Avoid killing unrelated Node processes.

## Important interpretation

The audit has already found real hidden clean-start dependencies and fixed several. The user stopped for session budget, **not because they accepted the remaining layouts**. Resume the five-design audit next session; do not present this handoff as completion.
