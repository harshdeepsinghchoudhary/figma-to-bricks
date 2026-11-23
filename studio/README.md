# Figma to Bricks AI Studio — local implementation

## Start

From `C:\figma-to-bricks`, using Node.js 24:

```powershell
npm.cmd ci --include=dev
npm.cmd run studio:build
npm.cmd run studio
```

Open the exact session URL printed by the server. It listens only on `127.0.0.1:4317`. Keep the terminal open. Set `STUDIO_PORT` to use a different port. Rebuild the frontend after changing its source. Chrome or Edge must be installed for visual capture; `BROWSER_EXECUTABLE` can select a browser.

## One-click workflow (added 2026-10-28)

1. Restart Studio after rebuilding. In **Integrations ? Connect Codex and your website**, click **Connect Codex**. Follow the OpenAI device-login instructions displayed there. This is a local Codex connection, not this chat session.
2. Fill **Figma access token**, **WordPress MCP endpoint URL**, **WordPress username** and **WordPress application password**, then **Save connections**. Optionally encrypt them with the vault. Blank fields preserve existing settings.
3. In **New Conversion**, paste a Figma frame URL and click **Convert with Codex ? WordPress draft**.

The action extracts and compiles, makes a job-owned copy, provisions/binds WordPress menus, reviews all compiled sections with Codex, retains validated local improvements, and injects that retained tree directly into a new draft. It does not rebuild over the fixes. The draft link and reviewed JSON appear in Execution. The source compiler and shared merged output are not modified by the repair steps. Extraction/compilation still update the normal cached frame.

Limits: 1?40 sections, 0?2 repair rounds per section, one-hour job timeout. Existing local sign-in or CODEX_API_KEY is also supported. Device login may need enabling in your OpenAI account settings: https://learn.chatgpt.com/docs/auth . Sign-in credentials persist under ignored .studio/codex-auth; temporary reasoning-session copies are removed on completion/cancellation/restart.

The one-click workflow performs local visual review and a server render check during import. It does **not** authenticate a browser into WordPress or certify live frontend/native interactions. A failed review prevents draft injection, though menu provisioning may already have occurred. Retrying starts a new job and may create a new draft if a prior job reached injection.

Verification for this addition: 94 tests and production build passed; device login/process behavior and all-section candidate-to-inject orchestration used fixtures. No live account sign-in or WordPress write was performed during these tests.

## What works

- React/TypeScript dashboard, conversion workspace, project list, persistent job history, activity logs, cancellation and retry, light/dark modes.
- Figma URL validation and top-level frame discovery through the REST API. Select one frame per conversion. Existing saved source and assets can also be used.
- Existing CLI pipeline performs extraction, provider-assisted normalization, compilation, structural validation and editable Bricks export. Deterministic mode remains available.
- Agent conversion first invokes the deterministic compiler, then uses the official Codex SDK for selected-section visual diagnosis and bounded styling corrections. API vision review is also available.
- Desktop and configurable tablet/mobile capture, DOM/computed-style measurements, overflow/broken-image checks, side-by-side images, overlay and heatmap.
- Bounded repair iterations, no-improvement stop, validation before candidate evaluation, and best-result retention. Candidates are isolated from shared compiler source and original merged output.
- WordPress draft creation reuses the existing pipeline, media upload and menu provisioning. It creates a new draft; it does not publish or select an existing page to overwrite.
- Optional read-only capture of a frontend URL on the configured WordPress origin. That screenshot is supplied as initial diagnostic evidence; candidate fixes are not deployed automatically.
- AES-256-GCM encrypted connection vault with a user passphrase and scrypt key derivation. The passphrase is not persisted. Unlock again after restarting.

The Node HTTP backend wraps existing services. Vite builds the React interface. This avoids moving the compiler into a second server framework. See `ARCHITECTURE.md` for integration decisions.

## Credentials and configuration

Existing `.env` values remain supported. Integrations lets you override allowed values in server memory, then optionally encrypt them in `.studio/connections.vault`. Saving a vault does not remove existing plaintext `.env` settings. Settings are never returned to the frontend.

| Setting | Use |
| --- | --- |
| `FIGMA_TOKEN` | Figma personal access token with access to the selected file |
| `AI_PROVIDER` | Existing normalization provider: anthropic, gemini, groq, nvidia, ollama, or auto |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY` | Selected provider credential |
| `<PROVIDER>_MODEL` | Provider model selection |
| `VISUAL_PROVIDER`, `VISUAL_MODEL`, `VISUAL_MAX_TOKENS` | Image-capable review model and response budget |
| `OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL` | Existing local provider configuration |
| `CODEX_API_KEY` | Optional SDK API authentication; otherwise existing local Codex sign-in is used |
| `STUDIO_AGENT_MODEL` | Optional Codex model override |
| `WP_API_URL`, `WP_API_USERNAME`, `WP_API_PASSWORD` | Existing WordPress MCP integration credentials |
| `STUDIO_PORT`, `BROWSER_EXECUTABLE` | Local server/browser settings |

Normal agent requests have read-only sandboxing, shell/app/web tools disabled, no user MCP configuration copied, no WordPress secrets, and no approval escalation. The controller owns compilation, validation, capture and restricted styling patch application. Shared source repairs remain a separate development task. Jobs stop after 20 minutes; SDK reasoning requests have a three-minute limit. One conversion runs at a time.

## Verification performed on 2026-10-27

- Production frontend build and TypeScript check passed.
- 91 Node tests passed, including compiler regressions, job/session security, restricted patching, best-candidate retention, iteration bounds and encrypted vault tamper rejection.
- Playwright UI checks at 1440px and 390px passed without horizontal overflow or JavaScript errors.
- Real cached PG Slot source compiled through the backend; screenshots/DOM measurements and comparison artifacts were produced; exported JSON passed structural validation. This was not a fresh Figma fetch or WordPress import.
- The configured vision API and Codex SDK each passed a real small image-fixture request. This proves adapter connectivity, not successful design repair.
- Patched Sharp and fast-uri; npm reported zero known dependency vulnerabilities after installation.

Reproduce:

```powershell
npm.cmd test
npm.cmd run studio:build
node tools/studio-smoke.mjs
node tools/studio-smoke.mjs --workflow
# Optional real provider requests (may incur usage):
node tools/studio-provider-probe.mjs api
node tools/studio-provider-probe.mjs codex
```

`--workflow` recompiles the saved PG Slot output. Source-layout regression fixtures are isolated under `tests/fixtures/source-layout` so this does not replace their legacy layered-artwork input.

## Remaining scope — do not treat this as complete SaaS or full live repair

- The agent controller currently follows a fixed capture/propose/validate/evaluate loop. It does not yet provide a freely planning MCP tool agent, normalized-property repair/recompilation, or tool-by-tool conversation streaming.
- Manual review targets one selected section. The new one-click action reviews all compiled sections; local review still does not establish live frontend acceptance.
- Corrections patch allowed generated style settings. The new one-click action injects its retained candidate. The older separate Create new WordPress draft action still uses the original compiled output.
- Automated staging deployment of each candidate, authenticated draft preview, native-component interaction checks, approval-gated publishing and retained staging-page updates remain to implement. No live WordPress import/repair loop was tested in this implementation.
- Local rendering approximates Bricks. Native navigation/slider scripts and exact site fonts can differ. The full-page pixel score plus overflow penalty is diagnostic, not a visual-similarity guarantee. Matching responsive Figma references, regional scoring and richer geometry issue detectors remain pending.
- Projects currently save a name and source-frame association; arbitrary saved project configurations, multi-frame queues and checkpoint continuation remain pending. Interrupted jobs can be retried, not resumed mid-step.
- There is one local WordPress configuration, no tenant/user system, OAuth Figma flow, site-switching UI or hosted deployment support. Temperature controls are not exposed.
- A real fresh Figma → AI normalization → WordPress staging → autonomous repair acceptance run remains required before production claims.

Original CLI commands remain available. No GitHub commit or push was performed.

SDK reference verified during implementation: https://learn.chatgpt.com/docs/codex-sdk
