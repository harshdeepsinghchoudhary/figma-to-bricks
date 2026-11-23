# Automatic WordPress browser verification

## Start

```powershell
npm.cmd run studio:build
npm.cmd run studio
```

In Integrations configure Figma, your AI provider and WordPress MCP. For private drafts also configure Draft preview login username/password. This is a WordPress browser-login password, not an application password. It stays server-side, can be stored in the existing encrypted vault and is not sent to the reasoning model. Sites requiring CAPTCHA, 2FA or custom login pages are not currently supported by this login adapter. Use a designated staging account/site.

Choose New Conversion -> Convert with my agent to WordPress draft. The workflow now:

1. Extracts Figma and normalizes through the selected AI provider (Codex uses the existing SDK login).
2. Compiles using the existing compiler and copies the build into job-owned storage.
3. Binds menus and creates one draft.
4. Updates that same draft for candidate corrections, opens its actual frontend with Playwright, captures source-width/tablet/mobile evidence and compares against Figma.
5. Uses bounded section-scoped styling corrections; validates every candidate, rejects regressions and restores the best tested candidate on ordinary errors.
6. Runs a final diagnostic pass over every section on the final draft. Reports `visual-checks-passed`, `needs-review`, or `verification-blocked` with the draft link. Native interactive behavior is explicitly not certified.

The UI exposes each section's evidence/change report and final overlay. Source/compiler edits are not granted to the runtime model. Export-only API/measured compilation remains available and does not claim frontend verification.

## CLI and MCP

```powershell
node scripts/pipeline.js "<Figma URL with node-id, without &t parameter>" --provider codex --force
```

After import this automatically invokes `verify-draft.js`, updating the page identified by that run's injection report. Do NOT add `--no-inject` or `--no-visual` when requesting the full workflow. Explicit skips remain supported. A verification failure/non-acceptance gives a nonzero CLI exit and preserves reports.

Reconnect MCP to load `convert_design`: this is the full automatic flow. `compile_design` remains export-only. The MCP client must authorize WordPress writes. The MCP watchdog remains 20 minutes; the app has its existing one-hour job limit.

## Validation performed

Full Node test suite; TypeScript/Vite production build; Playwright UI smoke at 1440 and 390 widths. Real Playwright fixture captures verified frontend evidence and rejection of a 404 draft. Tests cover 2x Figma screenshot scaling, preservation of browser height mismatch, one draft reused across repairs, shared source preservation, final verification passes, best-result restoration on capture failure and high-severity findings overriding low pixel error. Model/WordPress mutation orchestration tests use explicitly mocked dependencies, not a real remote conversion.

No live WordPress page was edited during this implementation. A complete real new-design run with configured browser authentication remains to be tested by the user. Do not interpret fixture success as live fidelity acceptance.

## Remaining limits

Runtime repair is limited to allowed styling settings. Missing structures, unsupported paints/components and compiler bugs are reported, not fixed by unrestricted source edits. Screenshot/DOM review is not an exhaustive functional interaction test. Screenshot pixel error is diagnostic; acceptance also requires no medium/high agent findings and responsive overflow/broken-image checks. Only the configured site origin is allowed for browser resources; external font/CDN resources can require future explicit allowlist support. Responsive checks without matching Figma frames test integrity, not exact reference fidelity.

Hard process termination/cancellation can interrupt restoration; a cancelled run must not be considered verified. Browser sessions are not persisted. This work does not certify the existing hosted preview as production-ready public SaaS.

Logs: `.review-work/automatic-frontend-tests.log`, `automatic-frontend-build.log`, `automatic-ui-smoke.log`.
