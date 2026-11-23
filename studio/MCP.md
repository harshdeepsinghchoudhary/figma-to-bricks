# Figma to Bricks MCP — use your existing agent

The local MCP server provides compiler tools to Codex or another compatible agent client. `compile_design` now defaults to Codex normalization: extraction -> Codex interprets measurements and cropped screenshots -> validated normalized JSON -> existing compiler. It uses the local Codex login (or CODEX_API_KEY), independently of the calling MCP client. Pass `mode: "deterministic"` explicitly for the old no-model path. Your connected agent can inspect and review the resulting candidate. Provider subscription limits and client permissions still apply.

## Connect Codex

This machine was registered as `figma-bricks-studio` in the user's Codex configuration during implementation. Restart/reload your Codex IDE extension or start a new Codex CLI session so it discovers the tools. Check the MCP server list.

For another machine, from this repository:

```powershell
npm.cmd ci --include=dev
codex mcp add figma-bricks-studio -- node "C:\figma-to-bricks\studio\mcp-server.js"
```

Use your actual absolute path. Codex launches the stdio server itself; there is no website URL or port to enter. `npm.cmd run studio:mcp` waits for an MCP client and is not an interactive terminal UI. Protocol traffic alone goes to stdout.

Official Codex setup: https://learn.chatgpt.com/docs/extend/mcp

## Credentials

Use the existing project `.env` with `FIGMA_TOKEN`, `WP_API_URL`, `WP_API_USERNAME`, and `WP_API_PASSWORD`. Secrets are read server-side, never returned as settings or tool arguments. Studio browser session overrides are not shared with this separate MCP process. No Codex/Claude API key is needed for this workflow. Sign into your official agent client normally.

## Suggested first prompt

> Use figma-bricks-studio to inspect the saved pgslot-thailand-com-84cdd226 design. Create an isolated candidate. Inspect the FAQ source and screenshots, compare desktop and mobile layouts, apply only evidence-backed supported styling fixes, validate, and export. Do not write to WordPress yet. Tell me which issues require compiler development or real frontend verification.

For a new design, provide its Figma frame URL. After reviewing evidence, explicitly authorize a new WordPress draft. The agent then uses `create_wordpress_draft` and polls `get_job`. That tool uploads media/provisions menus and creates a new editable page; it does not publish or choose an unrelated existing page.

## Tools

- `list_designs`, `compile_design`, `sync_bricks_schema`
- `get_job`, `cancel_job`
- `create_candidate`, `inspect_design`, `validate_candidate`
- `get_image`, `capture_preview`
- `apply_settings`, `export_candidate`, `create_wordpress_draft`

Compile and draft jobs return immediately with a job ID. Poll until completion. Only one mutation/capture runs at a time per server. Jobs stop after 20 minutes. Compiler processes use explicit argument arrays and never a shell. Candidate tools do not expose arbitrary paths or source-code editing. Patches are limited to supported styling settings, 30 per call and 300 per candidate. Artifacts are ignored under `.studio-mcp/`.

Inspect individual Figma section IDs from `create_candidate`; full-frame context can exceed the response budget. `get_image` supports vertical crops for long screenshots. Compare pixels only at the source frame width; smaller viewports report DOM integrity without asserting a responsive Figma match.

## Verified and remaining

`node tools/studio-mcp-smoke.mjs --compile` exercises a real MCP client/server connection and PG Slot compilation. The subsequent candidate inspection, validation, unsafe-patch rejection, permitted patch, Playwright capture, returned image and export passed. These tests made no model requests and no WordPress writes. Codex registration succeeded, but a new user Codex session still needs to discover and exercise the server.

The first complete live Figma-to-WordPress acceptance run is still pending. Draft rendering and authenticated frontend interactions are not proven by local preview. Public frontend capture works only on the configured WordPress origin; draft URLs requiring a browser login may return 404. There is no browser-login tool yet. Patches are output styling corrections, not normalized-data repairs. There is no checkpoint/best-candidate selector; agents should create separate candidates when comparing alternatives. Failed injection can leave uploaded media or an empty draft; repeated successful calls reuse the recorded draft, but interrupted writes may need manual inspection before retrying.

Never infer visual acceptance from process success. Report unsupported/compiler bugs for a separate development workflow. Do not run separate servers against the same cached frame concurrently; the serial lock is per process. No GitHub push was performed.

## Codex normalization from the CLI

Sign in to the local Codex CLI first (`codex login`). Optional `CODEX_HOME` selects the login directory; optional `CODEX_MODEL` selects a model. No Groq key is needed for this mode.

```powershell
npm.cmd run pipeline -- "<Figma URL with node-id>" --provider codex --force --no-inject --no-visual
```

`--force` regenerates cached normalization instead of reusing an earlier deterministic result. Remove `--no-inject` only when you want the normal WordPress import stage. Do not combine `--provider` with `--deterministic`. Refresh the MCP connection to load the updated tool schema. Codex uses the same normalization schema, validation and repair prompts as the API providers; it cannot edit compiler code or access inherited MCP tools. Failed Codex responses stop the affected section rather than silently using a Figma-only fallback. This does not guarantee visual fidelity.
