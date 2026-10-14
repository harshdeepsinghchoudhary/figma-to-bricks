# Compiler upgrade report

14 October 2026. The existing compiler was upgraded in place. The extractor, AI normalization option, structure rules, section merge, media resolution, stable ID namespaces, MCP injector and dataset workflow remain available.

## What changed

The former automatic visual gate could spend provider quota and prevent valid generation. It has been removed from the normal pipeline and default tests. Normal generation validates hierarchy, verified native setting keys/choices, component structures, breakpoint suffixes, existing global class references and local media. It never runs screenshots or visual AI after compilation.

Previously interactive designs could compile as generic containers or unsupported nodes. Semantic recognition now uses annotations, hierarchy, layer names, layout, link relationships and header geometry. Ambiguous designs stay editable and are reported. Sliders require carousel evidence; ordinary card rows remain flex/grid.

Measured Figma reconciliation now overrides model guesses for Auto Layout, padding/gaps/alignment, fill/hug/fixed sizing, constraints, copy, typography, backgrounds/linear gradients, borders/radii, shadows and supported positioning/clipping. Raw source metadata and coverage reports retain complex effects and hidden nodes. Simple axis-aligned lines use native borders instead of requiring missing legacy SVGs. Extraction requests vector paths/component metadata, preserves source image fills separately for editable layered content, and backs up inputs/assets before refresh.

## Native support

| Component | Generated structure/configuration | Remaining input or verification |
| --- | --- | --- |
| Navigation | `nav-nested`, native menu wrapper, open/close `toggle`, optional `dropdown`, editable `text-link` children; measured mobile switch threshold | Missing destinations remain unset. Real frontend behavior requires inspection. |
| Slider | `slider-nested` with editable slide wrappers, verified item/gap/loop/arrows/pagination/speed/autoplay settings and responsive item counts | Autoplay is configured only when explicitly supplied. Frontend motion is untested. |
| Tabs | `tabs-nested` with matched native title and pane lists | Ambiguous/mismatched lists are retained and reported. |
| Accordion | `accordion-nested` with native item/title/content wrappers | Ambiguous item structure is retained and reported. |
| Form | Native `form` fields repeater, editable labels/types, supported submit text/actions | Requires explicit fields. Recipients/actions are never invented; delivery is untested. |
| Cards, grid/flex, buttons, images/icons | Native editable layout/content, conservative repeated-card recognition and original assets | Cards do not automatically create global Bricks components/templates. |

Existing global class IDs and safe CSS variable values can be preserved. Unknown class references fail validation. No classes, variables or reusable component resources were created on the site.

## Responsive generation

The connected site's actual keys and widths are saved in `schema/runtime/site-context.json`: desktop base, tablet 1024, landscape mobile 767, portrait mobile 478. Compilation generates stacking, grid/width/spacing rules and native component breakpoint options. An explicit `responsive-frame-map.json` can map desktop elements to separately extracted tablet/mobile source nodes; those measurements override inference. Missing/ambiguous mappings fail explicitly. Unprovided Figma frames are not guessed or fetched silently. Current automatic inference is desktop-first.

## Files changed

| Area | Files |
| --- | --- |
| Orchestration | `scripts/pipeline.js`, `scripts/run-all.js`, `scripts/run-sections.js`, `scripts/doctor.js`, `package.json` |
| Figma preservation | `scripts/1_extract_figma.js`, `scripts/2_normalize.js`, `scripts/graphic-detect.js`, new `scripts/figma-preservation.js`, `scripts/figma-settings.js`, `schema/normalized-schema.json` |
| Native compilation | `scripts/3_compile_bricks.js`, `scripts/bricks-schema.js`, new `scripts/native-components.js`, `scripts/breakpoints.js`, `scripts/responsive-sources.js` |
| Structure protection | `scripts/structure-pass.js`, `scripts/structure-rules.js`, `scripts/responsive-pass.js`, new `scripts/layout-boundaries.js` |
| Schema and integration | `scripts/sync-bricks-schema.js`, new `scripts/bricks-mcp-readonly.js`, `schema/runtime/`, `scripts/bricks-validator.js`, new `scripts/validate-build.js`, `scripts/4_inject_mcp.js` |
| Manual debugging | `scripts/6_visual_review.js`, `scripts/visual-patches.js`, `tests/manual-visual.manual.js` |
| Tests/tools | `tests/project.test.js`, `tests/figma-preservation.test.js`, `tests/native-components.test.js`, `tests/native-integration.test.js`, `tests/responsive-sources.test.js`, `tests/schema-sync.test.js`, `tools/regression.mjs`, `tools/prepare-staging-build.mjs`, `tools/native-integration.mjs` |
| Guidance/configuration | `README.md`, `docs/current-workflow.md`, `MIGRATION.md`, `UPGRADE_PLAN.md`, `UPGRADE_AUDIT.md`, this report, `.env.example`, `config/ollama-6gb.env.example` |

Private `.env` and original design outputs were not replaced. Source backups are under `.review-work/upgrade-backup-*`, schema backups under `.review-work/schema-sync-*`, and staging/regression outputs use isolated folders. No GitHub push or production page change was made.

## Validation and staging

- All 43 default nonvisual tests passed, including deterministic normalization without AI/screenshots, native structures, preservation, custom responsive references, schema discovery, unsafe-setting/media rejection, pipeline independence from visual credentials and backend-placeholder reporting.
- All 66 saved normalized inputs compiled successfully across CasinoFX, both Jilislot designs, landing-page, Match Plus and fixtures. Regression reports explicitly identify nonvisual validation.
- Cached CasinoFX built 10 page sections, excluding four contained decorative shapes, into 700 schema-valid elements. Its 87 local assets validated. Six unset navigation destinations are warnings.
- Fresh deterministic CasinoFX normalization/build passed locally with native navigation and 772 schema-valid elements. It used no AI provider or screenshot comparison. The whole-source audit accounts for all 893 Figma nodes through represented nodes, exported graphics and recorded absorbed paints.
- A separate 57-element fixture covers the five new native interactive component families. Read-only live Bricks rendering accepted native parent options and rendered form fields/submit markup. Nestable parents return child placeholders in the detached render ability; that call cannot prove their frontend children or JavaScript behavior.
- After you confirmed the configured site is staging, one new **draft page 3673** was created: [open in Bricks](https://casinodesign.bcit.in/?page_id=3673&bricks=run), [draft frontend](https://casinodesign.bcit.in/?page_id=3673). It saved 700 elements, resolved 122 media references with zero failures, and regenerated CSS. Existing pages were untouched. Injection reports and snapshots are in `.review-work/staging-casinofx-upgrade/`.
- Live readback confirmed all 700 saved IDs, element types, parents, child order and settings match the injected snapshot, allowing Bricks' harmless empty-object/empty-array normalization on one toggle. Native navigation retains its protected menu wrapper, two toggles and six links. Comparing the staging build with the latest cached-input regression after resolving local media paths found zero added, removed or changed elements. The 772-element deterministic build is a separately tested normalization mode, not an unexplained mismatch with this cached-input draft.

## Skills and MCP

No `bricks-*` client skills are loaded or installed in this client. Skills are optional guidance; this upgrade uses verified runtime controls directly. The official installation workflow is to copy the prompt from WordPress → Bricks → AI → Skills, install it in the client, then start a new chat.

The connected site reports Bricks 2.4.2, Bricks abilities 2.0.0 and adapter 0.6.1. Discovery found 170 abilities, including 125 enabled and 45 disabled. Read-only start-here/version/status, element catalogs/schemas, breakpoints and design context were verified. Nineteen supported element schemas are saved. Detailed evidence and official documentation links are in [UPGRADE_AUDIT.md](UPGRADE_AUDIT.md).

## Commands

```powershell
npm.cmd test
npm.cmd run regression
npm.cmd run pipeline -- --frame output/casinofx-homepage --no-inject
npm.cmd run pipeline -- "https://www.figma.com/design/QWeNLqVxWvyzYENYnMrvBk/Online-Betting-Website-2--Copy-?node-id=202-12&t=i0shDqSdFY6ahU2x-0" --deterministic --no-inject
```

After you personally observe a layout fault:

```powershell
npm.cmd run visual -- output/casinofx-homepage --only=section-03 --problem="The image overlaps the text" --page-url="https://your-staging-site/page/"
```

Manual debugging requires one reported problem, one section and one frontend URL or explicit `--local-preview`. It captures only the chosen viewport and permits one targeted candidate/recheck. It cannot modify unrelated sections, content, appearance or breakpoint settings. Actual frontend resolution is not claimed from an approximate local candidate. Provider unavailability affects this manual tool alone.

## Remaining limits

Six CasinoFX navigation URLs are absent from the provided Figma data and need configuration before publishing. Forms need real actions/recipients. Complex masks, rotations/shears, stacked paints, multiple shadows and custom image crop matrices are preserved and reported where mapping is incomplete. Live Figma source-image-fill downloads were not refreshed during this run; extraction tests cover handling/backup logic and saved input rather than a new live API export.

Actual frontend visual quality, menu/slider/tab/accordion interaction, animation behavior and form delivery remain **unverified** until exercised on the generated draft. No automatic visual comparison was run.
