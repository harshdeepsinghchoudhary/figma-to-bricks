# Studio continuation — 2026-10-27

Read `studio/README.md` first for commands, tested capabilities and explicit limitations, then `studio/ARCHITECTURE.md`.

## Implemented

React/TypeScript/Vite UI around existing Node compiler. Existing CLI preserved. Dashboard/projects/history/settings, source/frame discovery, compile/export/validate, new WordPress draft action, bounded SDK/API visual review, local screenshots/overlay/heatmap/DOM metrics, best-candidate retention, cancellation/retry, encrypted connection vault. Runtime agents cannot write shared compiler source. No GitHub commit/push or WordPress write performed.

Core paths: `studio/server.js`, `core.js`, `conversion-worker.js`, `review-worker.js`, `agent.js`, `visual.js`, `vault.js`, `web/`. `.studio/` and `studio/dist/` are ignored. Existing public/ is retained but no longer served as a stale fallback; run `npm.cmd run studio:build`.

## Verification

91 tests passed. Production build passed. `node tools/studio-smoke.mjs --workflow` passed on actual saved PG Slot data, compiled through backend, captured source-width and mobile images, downloaded validated native-element JSON. No fresh external Figma request or WP write in that test. Both `node tools/studio-provider-probe.mjs api` and `codex` passed real small image-fixture calls (not full conversion/repair). Sharp and fast-uri updated; npm audit reported zero vulnerabilities. Provider calls required network permission in this environment.

The smoke run refreshes PG Slot generated output; do not blindly discard working-tree changes. Old artwork tests depended on mutable normalized output, so three legacy section inputs are now pinned in `tests/fixtures/source-layout`. Source and compiler code otherwise preserved.

## Resume here

1. Add candidate staging integration: currently draft creation imports original merged output, not isolated repaired candidate. Reuse existing injector with owned job/staging manifest and explicit designated page IDs; never select unrelated live pages. Ensure media paths resolve against original source artifacts.
2. Deploy each validated candidate to owned staging, capture actual frontend and DOM at each viewport, evaluate and restore best validated staging version. Initial optional frontend capture is already available and supplied to the model but is not updated by repair iterations.
3. Add normalized-property corrections before generated styling fallback, with source evidence, strict schema and recompilation. Current restricted patches cover styling only.
4. Extend fixed controller into a tool-planning agent with validated tool schemas and budgets. Do not restore the old workspace-write CLI agent. Existing SDK is read-only, shell/apps/web disabled, separate ephemeral auth home, stripped environment.
5. Add regional metrics, explicit responsive frame references, native menu/slider interaction tests, full design review queues, persisted project config and supported checkpoints. Current project record is just name/frame and retry starts over.
6. Test fresh Figma extraction, real AI normalization and WordPress import/repair on a designated staging page; do not claim acceptance from local approximation.

Current intentional limitations are listed in README; this is a working local vertical slice, not completion of every item in the master prompt. Do not describe free-planning agent tools, automatic staging repair, publish approval or full SaaS as implemented.

Start:
```powershell
npm.cmd ci --include=dev
npm.cmd run studio:build
npm.cmd run studio
```
Open exact terminal URL. No credentials are in this handoff. Keep API credentials out of all logs and artifacts.
