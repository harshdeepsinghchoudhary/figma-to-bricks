# Compiler upgrade audit

Audit date: 14 October 2026. This records repository inspection and read-only discovery of the configured WordPress site. It does not certify frontend behavior or visual quality.

## Existing working functionality

The project already extracts the raw Figma node tree, geometry, screenshot and exported media; normalizes semantic layout; corrects nesting through deterministic structure rules; compiles editable Bricks element arrays; resolves WordPress media; merges sections; and captures injection and dataset snapshots. Cache provenance, stable element ID namespaces, failed-section protection, asset errors and parent/child consistency checks are already present. The optional visual debugging implementation and its provider handling can remain available independently.

Saved CasinoFX inputs and assets provide the initial regression case. Existing `.test-work/` and `.review-work/` directories are isolated test artifacts rather than design inputs. Existing design folders and production pages must remain unchanged during upgrade testing.

## Prioritized weaknesses and implementation plan

| Priority | Observed weakness before the upgrade | Required change |
| --- | --- | --- |
| 1 | Visual review was a generation and injection gate; provider failures could prevent an otherwise valid compiler build. | Remove automatic visual orchestration. Keep explicit, section-scoped debugging for a user-reported layout problem. Normal generation uses nonvisual validations. |
| 1 | Runtime schema sync covered only 10 basic element types and omitted active site breakpoints/version context. | Read installed element catalog, read-only ability status, exact native schemas, active breakpoint configuration and design references. Reject unregistered requested types. Preserve old local snapshots. |
| 1 | Interactive components were generic groups or unsupported nodes. Appearance did not provide functional navigation, sliders, tabs or accordions. | Add evidence-based recognition and native Bricks structures using verified setting names, options and required wrappers. Test uncertain components with separate fixtures. |
| 1 | Geometry and styling depended too much on the model's reduced normalized representation. Auto Layout, constraints, masks, typography runs and component provenance could be lost or reduced to notes. | Copy measurable Figma source properties deterministically; preserve original provenance and report unsupported source features. Apply measurable layout values during compilation. |
| 2 | Known setting keys came from incomplete exported examples; unknown types/settings were warnings. | Validate generated native elements, supported controls, option values, hierarchy and assets against runtime snapshots before injection. |
| 2 | Responsive behavior assumed a small fixed breakpoint vocabulary. | Use the site's active base breakpoint and cascade direction; map semantic tablet/mobile layouts to actual keys and retain explicit Figma responsive overrides. |
| 2 | Global classes and variables lacked current site references. | Preserve explicitly configured class IDs and CSS variable values. Validate references and avoid creating duplicate or guessed design tokens. |
| 3 | Figma appearance alone cannot specify form destinations, arbitrary interactions or autoplay intent. | Preserve explicit behavior configuration; report missing functional configuration. Do not invent email recipients, actions, links or animation requirements. |

## Bricks skills availability

No `bricks-*` skills are loaded in the current Codex skill catalogue. No installed Bricks skill files were found in `C:/Users/LENOVO/.codex/skills/` or `C:/Users/LENOVO/.codex/plugins/cache/`. The global `C:/Users/LENOVO/.agents/` and `C:/Users/LENOVO/.bricks/` directories were absent. No repository-local `.agents/` or `.codex/` skill directory was present at inspection.

This is a client guidance check, separate from site abilities. Bricks skills do not add compiler code, site permissions or MCP actions. No skills were installed during this audit. To install them through the official UI workflow, copy the install prompt from **WordPress → Bricks → AI → Skills**, paste it into Codex, then start a new chat and use its verification prompt. The package README also documents a release-managed Codex installation; any later installation should follow that verified README rather than invented commands. See [official Bricks guidance](https://academy.bricksbuilder.io/builder/features/ai-abilities-and-skills/) and [the Bricks Skills repository](https://github.com/codeerhq/bricks-skills).

## Verified MCP connection

The configured endpoint responded successfully to read-only MCP initialization, tool listing, ability discovery and schema reads. The installed contract reports:

| Item | Runtime value |
| --- | --- |
| Bricks | 2.4.2 |
| Bricks abilities contract | 2.0.0 |
| WordPress | 7.1.3 |
| WordPress MCP Adapter plugin | 0.6.1 |
| MCP server advertised version | v1.0.0 |
| MCP protocol | 2025-06-18 |
| Abilities registered | 170 |
| Enabled abilities | 125 |
| Disabled abilities | 45: 40 admin-disabled, 5 default-disabled |
| Registered element types | 78 |

Advertised direct tools include the three adapter dispatcher tools, `bricks-get-design-context`, repository/file discovery tools and `bricks-create-post`. Long-tail abilities were invoked through the dispatcher only after checking their real ability schema and `readonly: true` annotation. The direct tool name uses hyphens; the dispatcher ability name uses a slash.

Read-only calls included `bricks/start-here`, `bricks/get-mcp-version`, `bricks/list-ability-status`, `bricks/list-element-types`, `bricks/get-element-schema`, `bricks/list-breakpoints`, `bricks/get-design-context`, and builder guide topics `elements`, `layout`, `styling` and `components`. The `get-builder-guide` ability requires a topic; a no-argument call is not valid.

Verified abilities also include page/element reads and writes, nonpersisting element rendering, templates, components, global classes/variables, navigation menus, form configuration, interactions and conditions. Availability is recorded per ability in `schema/runtime/site-context.json`; discovery alone does not prove a write ability is enabled or authorize its use. No production page mutations were performed.

## Native runtime schemas

`schema/runtime/` now contains 19 runtime schemas:

`section`, `container`, `div`, `block`, `heading`, `text`, `text-basic`, `button`, `image`, `icon`, `text-link`, `nav-nested`, `dropdown`, `toggle`, `offcanvas`, `slider-nested`, `tabs-nested`, `accordion-nested`, `form`.

The actual registered element names end in `-nested`; labels containing “Nestable” are not element identifiers. Native navigation uses `gap` and `mobileMenu`, rather than guessed `itemGap` or `mobileMenuBreakpoint` keys. Its canonical default tree contains a protected `block` with `tag: ul` and internal `brx-nav-nested-items` class, links/dropdowns and the close toggle, followed by the open toggle. Dropdown content uses a protected `div`, `tag: ul`, and `brx-dropdown-content` class. Those required wrappers are returned in runtime `nestableChildren`.

Slider settings include native `perPage`, `perMove`, `type`, `gap`, `speed`, `autoplay`, `interval`, `arrows` and `pagination`. Tabs and accordions are nestable; forms are nonnestable and expose a `fields` repeater and `actions`, not child input elements. The runtime schemas do not currently include canonical `nestableChildren` for slider/tabs/accordion, so their wrapper contracts need official documentation or targeted read-only render verification. Public developer schemas are available for [tabs](https://academy.bricksbuilder.io/developer/schema/elements/tabs-nested/), [accordions](https://academy.bricksbuilder.io/developer/schema/elements/accordion-nested/) and [sliders](https://academy.bricksbuilder.io/developer/schema/elements/slider-nested/); the installed runtime remains authoritative for registered controls.

## Site responsive and design context

The site is desktop-first with custom breakpoints enabled: `desktop` is the base at 1279 px, `tablet_portrait` is 1024 px, `mobile_landscape` is 767 px and `mobile_portrait` is 478 px. The tablet setting differs from Bricks' 991 px default. Base settings have no breakpoint suffix. Values and direction are saved in `schema/runtime/site-context.json`.

The design context contains four global classes, two variables and no reusable components. Class IDs/names and variable IDs/names/values are retained as allowlisted design references. No credentials or unrestricted global settings are copied into the schema snapshot.

## Schema synchronization changes and checks

`scripts/sync-bricks-schema.js` now uses a single initialized MCP connection, verifies installed ability metadata and enabled status, reads the paginated registered catalog, checks safe element identifiers, reads all requested schemas before updating snapshots, saves version/breakpoint context and preserves previous local files under `.review-work/schema-sync-*/`. Credentials are confined to HTTP authentication headers; error messages do not echo server bodies.

`node scripts/sync-bricks-schema.js` refreshes the supported default set. `node scripts/sync-bricks-schema.js --elements=section,container,form` reads an explicit registered subset. Unsupported or unsafe names fail before any schema file is written.

`node --test tests/schema-sync.test.js` passes three tests covering unsafe/unregistered names, recoverable snapshots and breakpoint preservation, allowlisted design references, and refusal to execute an ability whose metadata does not prove it is read-only.

## Read-only native backend integration

The separate 57-element native fixture was rendered through `bricks/render-elements` in existing page context 3435 without saving it or capturing screenshots. Five native components were checked. All backend assertions passed: native navigation parent/label/mobile switch; Splide track/list, loop, three desktop slides, 20 px gap, 400 ms speed, arrows/pagination and two/one/one slides at 1024/767/478 px; initial tab index; accordion expanded item/transition; and three actual form fields plus the native “Send inquiry” submit button.

The installed render ability returns `brx-nestable-children-placeholder` for navigation, slider, tabs and accordion descendants. Consequently those child HTML wrappers and interactive behavior remain unverified by this particular read-only call. The fixture form intentionally has no configured actions, so no submission or delivery was tested. `.review-work/native-integration/report.json` records each condition and this partial verification status. The optional `tools/native-integration.mjs` probe is separate from the normal pipeline and takes an existing `--page` only as render context; it saves no site content. Its two regression tests pass.

## Staging draft verification

The user explicitly confirmed the configured site as staging and authorized creating a new draft. The upgrade created draft **3673**, leaving previously existing pages unchanged. A read-only `bricks/get-page-elements` check returned all **700** injected elements. IDs, names, parents, child order and settings matched the injected snapshot, allowing only Bricks' PHP serialization of one empty toggle settings object as `[]`. Its native navigation contains the protected `ul` menu wrapper, two toggle elements and six text links. The saved-page render verifies its native parent configuration but still omits descendant HTML behind a placeholder. Evidence is retained in `.review-work/staging-casinofx-upgrade/merged/persist-verification.json`.

This records the 700-element draft at the time of readback. Any later compiler changes need a fresh staging rebuild and readback before that draft can represent the final implementation.

## Remaining verification boundary

Runtime schema discovery, compiler unit tests and staging persistence checks can establish JSON/configuration correctness. They do not establish actual frontend menu/slider/tab/form behavior, form delivery, global theme styling or visual quality. User frontend inspection and any separately authorized targeted behavior testing remain necessary. The discovered preview workspace ability freezes a validated candidate and returns render diagnostics; it does not document an authenticated frontend preview URL. Automatic screenshot comparisons are outside the requested workflow.
