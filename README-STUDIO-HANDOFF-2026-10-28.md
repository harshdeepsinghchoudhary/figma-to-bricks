# Studio one-click continuation — 2026-10-28

User requested a visible Codex connection and one-button Figma-to-WordPress workflow. Implemented on top of the previous Studio; no commit/push or live WordPress write.

- Integrations now has `Connect Codex` and explicit Figma token, MCP URL, WordPress username/application-password fields. Supported Codex CLI device authentication writes to ignored `.studio/codex-auth`; challenges stay in memory and clear on successful login. User must approve the OpenAI device sign-in. Existing CLI authentication/API key remains supported.
- New Conversion has `Convert with Codex to WordPress draft`. `autopilot-worker.js` compiles a source URL, makes a job-owned frame copy, binds menus, reviews every compiled section with Codex, carries retained validated changes forward, then passes the corrected tree directly to the existing injector. It never passes a user-selected page ID. Original compiled output is not overwritten by repair.
- Creates a new draft, shows builder link and reviewed JSON download. Maximum 40 sections, 0–2 repair rounds each, one-hour overall timeout. No automatic publishing. Menu provisioning can occur before a later review fails; retry may create another draft.
- Runtime Codex cannot edit shared source or call arbitrary WordPress tools. Temporary auth copies under section reports are cleaned after cancellation/restart; persistent local sign-in is retained.

Verification: production build, full regression suite (94 tests before the additional cleanup test), and desktop/mobile Playwright smoke passed. New workflow orchestration and device-login tests use fixtures/mocked child processes, not real account login or live draft creation. Existing provider fixture checks from 2026-10-27 remain prior evidence, not a fresh full-flow test.

Remaining: authenticated live frontend capture/redeployment loop, regional scoring, normalized-property repair, native interaction verification. Current workflow compares locally and invokes the existing server-side render check during draft injection; do not claim confirmed visual accuracy on the real frontend. Review artifacts are under `.studio/artifacts/<job>/sections/`; workflow.json summarizes section outcomes.

Start with `npm.cmd run studio:build`, then `npm.cmd run studio`. Open exact terminal URL. Restart any already running server to load the new routes. Read `studio/README.md` for setup. Next acceptance task is a controlled real one-click draft run with user-connected credentials, then live frontend verification.
## Multi-user update later on 2026-10-28

Read studio/HOSTED-PREVIEW.md. Added accounts.js (SQLite/scrypt/sessions), hosted-preview.js (loopback private-beta gateway and separate tenant processes), providers.js (explicit BYOK adapters and environment allowlist), AccountGate.tsx and provider/key controls. Operator .env/auth/output/runtime schemas are not inherited by tenant workspaces. Hosted device login is rejected. Original local Studio remains available.

97 tests/build passed; two-account worker isolation and Playwright mobile sign-in checks passed with fixture credentials. No live provider calls or WordPress writes in these new checks. Remaining before public hosting: container and network isolation, HTTPS/session configuration, provider OAuth registration, queue/quotas, recovery/backups/monitoring. Do not expose this preview publicly. No push.
## MCP-first update

Implemented studio/mcp-server.js and mcp-service.js using official MCP SDK v1 stdio. No nested AI calls: the user's signed-in agent selects tools. Compile is deterministic; candidates, validated settings patches, source inspection, image/capture tools, async jobs/cancel, export and explicit new-draft tool are exposed. Artifacts ignored in .studio-mcp/. Setup and limitations: studio/MCP.md.

Registered global Codex server figma-bricks-studio with the installed CLI after filesystem approval. Entry launches node and the absolute studio/mcp-server.js path. Restart Codex extension/new CLI session to load. No global credentials changed. 97 regression tests passed; real MCP smoke used PG Slot compile/candidate/patch/capture/export without model calls or WordPress writes. Live agent-led WordPress acceptance still pending. No arbitrary shell/file tools or runtime compiler edits. Draft writes require user scope authorization. No push.
