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

The connected site's schemas and context live in `schema/runtime/`; refresh them for another site/version. Client-side Bricks skills are optional guidance and do not run inside the compiler. See [UPGRADE_AUDIT.md](../UPGRADE_AUDIT.md) for discovered abilities, skills and verified site capabilities.

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

For GitHub transfer and your RTX 3050 laptop, see [MIGRATION.md](../MIGRATION.md). Ollama is optional: deterministic builds do not need it. Manual vision debugging can use your existing provider or a configured Ollama vision model. No model is downloaded silently.

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

