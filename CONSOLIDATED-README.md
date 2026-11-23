# Consolidated Project Documentation

This file combines the repository README files as they existed at consolidation time. Sections retain their source filenames and contents. The original files are preserved.

---

## Source: `examples\README.md`

# Seed examples for stage 2 (Figma -> normalized)

Each example is a verified PAIR, one folder per section:

```
examples/
  hero-01/
    figma-node.json     raw Figma node data (output of stage 1 for that frame)
    normalized.json     the CORRECT normalized JSON for it (see schema/normalized-schema.json)
    bricks-export.json  optional: the Bricks JSON you shipped, for your own reference (not sent to the model)
```

The model is asked to produce normalized JSON, so it must be shown Figma -> normalized pairs.
Bricks exports alone do not teach it the normalized format.

Rules for a good example:
- `normalized.json` must pass `node scripts/normalized-validator.js examples/<name>` (copy the file
  into a folder as normalized.json, or run the validator on that folder).
- Every number in it must be traceable to the Figma node data, not read off a screenshot.
- Pick examples that cover different things: a hero (row + image), a card grid (repeated column),
  a section with a responsive override, one with an `unsupported` element and notes.

Start with 2-3. If stage 2 output keeps making the same mistake, add an example that shows the
correct handling of exactly that case.

---

## Source: `README-AUTOMATIC-VERIFICATION-2026-10-28.md`

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


---

## Source: `README-BROWSER-AUTH-FIX-2026-10-29.md`

# Draft browser authentication repair

The failing job 9373d91d-2b13-4c1e-bd77-3d73ac1a3099 recorded HTTP 403, authenticated=false, loginConfigured=false, and a browser-security-check title. This establishes missing worker authentication, not that the user never entered credentials.

Changes:
- Browser access preflight runs before AI normalization and draft creation, and before production verification retry writes.
- A saved session is checked against wp-admin. Stale sessions no longer suppress configured password login.
- Integrations exposes only boolean password/session-loaded status, never credentials.
- Saving the connections vault includes the connected browser session encrypted inside it. Unlock restores it with the new process's session-encryption key. Existing vaults without a session still work.
- Security challenges still require the user-operated sign-in browser. Application passwords are never substituted for browser passwords.

Validation: production UI build passed; real Chromium fixture verifies stale-session fallback through a login form and cookie, with no external WordPress writes. Full test results: `.review-work/browser-auth-full.log`.

Activation: restart Studio once to load server changes, unlock the saved connections vault, and inspect the browser-password/session indicators. If the vault predates session retention and no password is loaded, connect using the sign-in browser, then save the vault. Retry job for draft 5076, not the manually edited reference 4955. The site's security challenge may still require manual interaction; a local fixture is not proof of live authentication.

No live pages were changed and no AI conversion was started during this repair.


---

## Source: `README-CODEX-NORMALIZATION-2026-10-28.md`

# Codex replaces the API normalization provider

Implemented extraction -> Codex normalization -> existing validation/postprocessing -> Bricks compiler. CLI selects `--provider codex`; MCP `compile_design` defaults to codex, with explicit `mode: deterministic` preserving the previous no-model path. Restart the MCP client connection to refresh tools.

```powershell
npm.cmd run pipeline -- "<Figma URL with node-id>" --provider codex --force --no-inject --no-visual
```

Uses existing local Codex authentication, optional CODEX_HOME or CODEX_API_KEY, optional CODEX_MODEL. No Groq key required. The SDK runs in an isolated temporary configuration with shell, patch tools, apps and inherited MCP configuration unavailable. Credentials and temporary screenshots are removed afterwards. The normalizer receives the existing prompt, cropped screenshot, manifest, schema, and validation-repair conversation. Source measurements still reconcile model output as in the existing API workflow. Codex sections use a 24000-token split budget instead of Groq's 4600-token default; explicit --split overrides it. Failed validation cannot silently fall back to deterministic leaf output in Codex mode.

Verified: 101 tests pass. A REAL authenticated SDK normalization of source node 11:4084 (section-01x) in recreate-attached-design-e3902415 succeeded with network access, produced schema-validated normalized.json and compiled successfully. The initial sandboxed attempt failed workspace routing; approved network-enabled retry succeeded. Log: `.review-work/codex-live-normalization.log`. Only this section was regenerated with Codex; other sections remain prior outputs. This is not full-page visual acceptance. No WordPress injection or GitHub push.

Adapter regression tests use a fake runtime explicitly to check prompt/image forwarding, restricted settings and cleanup. Those tests are separate from the real one-section run. Existing MCP smoke compile now explicitly uses deterministic mode to avoid unexpected model usage.

Next: run all sections with the command above (or saved --frame), then compare with source screenshot and actual WordPress frontend. Keep --force when replacing prior cached deterministic normalization. Do not claim exact design matching from successful compilation.

SDK reference verified: https://learn.chatgpt.com/docs/codex-sdk and installed @openai/codex-sdk README.


---

## Source: `README-COMPILER-REPAIR-2026-10-29.md`

# Compiler and browser review repair â€” 2026-10-29

## Changes

- Bind synthetic AI sections to their real source frames. Promote duplicated full-width section wrappers before applying site-width rules.
- Preserve measured source container widths and hero content offsets; remove inferred empty trailing padding from left-aligned single-text wrappers.
- Recover omitted full-bleed gradient layers as editable Bricks divs in source paint order.
- Flow containers and sections use minimum desktop heights and automatic tablet heights so wrapped content can grow. Preserve individual border-side widths.
- Permit Google Fonts stylesheet/font requests in the verifier while continuing to block unrelated external scripts/documents and other origins. Capture blocked-resource origins and actual rendered font names using Chrome's font inspection protocol.
- Stop layout AI corrections when a live capture shows font substitution. Report context/request budgets distinctly, and emit agent-analysis only for actual model calls.
- Retry older jobs by compiling their saved normalization, auditing it, and importing to the recorded draft ID. No extraction, AI normalization, or new page creation. Existing current-revision jobs keep their best reviewed output.

## Validation

- Full suite: 116 tests passed. Subsequent retry/browser/autopilot checks: 6 passed.
- Studio production build passed.
- Recompiled the saved design's selected 11 sections without AI; merged output has 357 editable elements, 34 local assets, zero validation errors. Five navigation destination warnings remain in the isolated build, which has not provisioned site menus.
- Local Chromium captures of hero and benefits at 1679, 1024, and 390 pixels had no horizontal overflow or broken images. Hero desktop screenshot inspected after restoring its 512px text column and overlays.
- Local previews substitute Arial for Plus Jakarta Sans; they are not proof of live font delivery or visual acceptance.

## Continue

Use Studio's existing job **Retry run**, not a new conversion. The worker will apply the compiler revision to the same recorded draft and run live verification using the connected browser session. Do not restart Studio unnecessarily, because its manual browser session key lives in memory.

No WordPress changes were made during this repair session. Live draft 4883 still needs the corrected import and frontend verification. No Figma/AI calls or GitHub pushes were made.

Isolated evidence: `.review-work/compiler-repair-2026-10-29/`.
Test logs: `.review-work/compiler-repair-tests-final.log`, `.review-work/compiler-retry-tests.log`.
Build log: `.review-work/compiler-repair-build.log`.

Remaining limits: font CDN allowlist currently covers Google Fonts only; other externally hosted fonts remain blocked and are reported. Native CTA semantics, all other page sections, interactions, and exact live visual fidelity require further frontend evidence. Do not label this a complete visual pass.


---

## Source: `README-DRAFT-ACCESS-2026-10-28.md`

# Draft access failure and retry

Run e6ddbcff-b0a5-4428-bf64-a278510d88ee successfully created WordPress draft 4771, with 353 elements and no asset failures. First frontend capture returned 403, before any AI visual review. User confirmed separate browser login configured and the draft opens in their own logged-in Chrome. Cause is not yet proven: automation authentication, account permissions, or site security denial.

Changes: capture now checks login endpoint status and WordPress logged-in cookie presence; failures save access-error.json and (when no password field is displayed) access-error.png. No credentials/cookie values recorded. Identical initial/restoration trees avoid redundant draft writes. App Retry uses resume-verification.js for jobs with existing injection records, copies their artifacts and resumes on the SAME draft. Cross-site retries are rejected.

Validation: existing 104 tests pass; new resume test independently passes. No remote page modified in this repair. Existing running Studio at port4320 has not been restarted: in-memory connection settings may be lost on restart, so save connections to the encrypted vault first. New access diagnostics and retry route take effect after restarting. Do not instruct a retry on the old server, which would still create another draft.

Next: save/unlock connection vault across restart, retry the existing job, inspect access-error.json to distinguish missing auth from post-login denial. No security protections were disabled; do not automatically bypass WAF or authentication challenges.


---

## Source: `README-FIDELITY-PASS-2026-11-05.md`

# Fidelity repair checkpoint â€” 2026-11-05

## Changes implemented

- Source-layout repair now resolves source parents through synthetic AI wrappers. Edge-to-edge, adjacent image-backed panels retain a full-width container and zero section side gutters. Ordinary separated cards do not trigger this rule.
- Source-image plus linear-gradient fills use the existing scoped overlay implementation. The photo and gradient no longer compete for `background-image`. Captions remain editable above the overlay. Other paint stacks retain their warnings.
- Browser evidence includes broken image elements and clipped editable text. The repair loop rejects candidates introducing new viewport integrity failures even when desktop pixel error improves, and restores the best candidate.
- Font verification accepts known platform weight/style suffixes (for example Plus Jakarta Sans SemiBold), while rejecting Arial fallback and unrelated families such as Inter Tight.
- The existing regression runner now merges every complete section-based design, including nested page sections, rather than only CasinoFX.
- Native slider wrappers and slides are capped to their containing width with zero minimum width, preventing fixed desktop slide sizes from forcing horizontal page overflow.

## Evidence and tests

- Full suite after all edits: 129 tests passed (`.review-work/fidelity-2026-11-05/tests-final.log`).
- Isolated example regression: 91 valid compilations. Seven CasinoFX sections fail because assets are missing from their saved manifests. Report: `.review-work/regression-1793877120785/report.json`. These are not visual acceptance results.
- Inspected saved Figma and real WordPress screenshots for Tapijtschuur section-05 from job `7220d102-9c74-4c27-9e4c-476e83e94836`. The old WordPress rendering constrained the 1679px composition to the site width and lacked the visible photo overlay.
- Corrected local photo-panel captures at 1679, 1024 and 390px: `.review-work/fidelity-2026-11-05/preview-fonts/`. No horizontal overflow, broken image elements or font fallback findings. Downloaded source font weights exist only in this isolated evidence directory, not application settings.
- Desktop Figma/local comparison: `.review-work/fidelity-2026-11-05/comparison.json`, `panel-after-fonts.png`, `overlay.png`, `heatmap.png`. Pixel error approximately 0.0797; this is a diagnostic, not a 92% similarity claim or live acceptance.
- Full Tapijtschuur local captures: `.review-work/fidelity-2026-11-05/full-page/`. No horizontal overflow or broken image elements at 1679/1024/390px. These full-page captures used fallback fonts and cannot validate typography.
- PG Slot local captures initially showed tablet/mobile horizontal overflow from 1120px slide blocks. Applying the final merged responsive pass fixed that overflow at 1024/390px (`pgslot-fixed/metrics.json`). These local captures use fallback fonts and do not load the real Bricks slider runtime, so they validate containment only, not slider behavior or full visual parity.

## Pending live verification / restart point

No WordPress page was modified in this pass. Preserve manually edited page 4955. Existing test draft 5148 belongs to job `7220d102-9c74-4c27-9e4c-476e83e94836`.

Studio currently runs on port 4317. The user was given its authenticated startup link and asked to unlock saved connections / reconnect the WordPress browser. Last checked connection state: Figma, MCP, Codex configured; browser password and browser session absent. Do not claim live review or import occurred.

After the user reconnects:
1. Verify draft browser access before spending AI calls.
2. Recompile the saved normalization in an isolated copy of the test draft's work directory, merge, validate, and inject only the designated test draft. Do not normalize every section again unnecessarily.
3. Run the bounded section review with actual WordPress screenshots at Figma width, 1024 and 390px; retain best candidates and report unresolved differences.
4. Preserve page 4955 as reference. Do not push GitHub.

Compiler revision was deliberately not bumped: automatic retries of historical manually edited drafts must not silently recompile and replace them. A normal new conversion already uses the changed compiler. Existing draft verification needs an explicitly selected isolated rebuild as above.

Remaining accuracy work includes source-aware collage grouping, broader typography/layout comparisons across examples, and full live acceptance. Native menu/slider/accordion behavior cannot be certified from the local approximation.


---

## Source: `README-FIDELITY-REPAIR-2026-10-28.md`

# New design fidelity repair

Target: `output/recreate-attached-design-e3902415`, source frame 11:4081, 1679 x 4095.

Implemented reusable fixes:
- Detect stacked sections through transparent, non-clipping Body/App wrappers.
- Share this detection between section runner, scoped normalization and merge spacing geometry.
- Preserve measured widths for non-Auto-Layout frames and fixed-width, auto-height text.
- Interpret whitespace around single intrinsic text labels as alignment, not giant horizontal padding.
- Regression coverage: `tests/nested-page-layout.test.js`.

Validation: full test suite and deterministic rebuild logs in `.review-work/tests-layout.log` and `.review-work/new-design-rebuild.log`. Rebuild uses no injection. Before the final centered-label change, local captures at 1679/1024/390 had no horizontal overflow or broken images. Desktop height was 4550 versus source 4095: this is NOT visual acceptance. Latest centered-label changes still require refreshed captures.

Remaining visible issues: local header/menu appearance, hero overlay/background ownership and height, full-width photo section constrained by site container, some text/button sizing, source font availability. Local renderer does not prove native Bricks menu behavior. Need authenticated frontend capture before accepting actual WordPress fidelity. Existing draft 4699 has not been updated by this repair.

Resume:
1. Read this note and inspect `.review-work/new-design/reference.png` against refreshed local captures.
2. Rebuild: `node scripts/pipeline.js --frame output/recreate-attached-design-e3902415 --deterministic --force --no-inject --no-visual --no-dataset`.
3. Use `capture` from `studio/visual.js` at 1679,1024,390. Source screenshot is approximately 2x: do not feed it directly into pixel comparison against 1x browser capture without explicit source-scale normalization.
4. Trace remaining differences through source -> normalized -> Bricks -> DOM; add focused regression checks, recompile, then test designated WordPress draft.

No GitHub push and no live page writes were performed during this repair.


---

## Source: `README-FONT-GUARD-FIX-2026-11-05.md`

# Visual review font guard

Latest affected run: `7220d102-9c74-4c27-9e4c-476e83e94836`, draft 5148.
Its browser captures succeeded. Every section stopped before agent analysis because a wrapper inherited Poppins while its child correctly rendered Plus Jakarta Sans. The guard compared descendant platform-font evidence to the wrapper's computed family, then propagated the issue by family across sections.

Fixed in `studio/visual.js`: check editable text elements only, per element rather than once per family. Fixed in `studio/review-worker.js`: scope font issues to their element IDs in the section.

Regression: real Chromium fixture with a missing wrapper font and correct Arial child does not report an error; a separate actual text element with a missing font does report an error. Full suite: 122 tests passed on 2026-11-05.

Studio started on port 4317. Its state currently has MCP/Codex configured but neither browser password nor browser session loaded. User must unlock the encrypted connections vault, or reconnect the sign-in browser, before live verification can resume. No remote writes or AI calls were made during this continuation.

Resume the existing 5148 job. Do not create another conversion or overwrite manually edited reference page 4955. Live visual acceptance remains pending.


---

## Source: `README-MANUAL-EDIT-RULES-2026-10-29.md`

# Rules derived from the edited draft

Reference: read-only saved snapshot of page 4955 at `.review-work/user-edits/page-4955.json`. Compared to the last import in job `64e7ec0e-b6f2-4197-882b-b40b235bbffa`.

Implemented reusable compiler behavior:
- Compact text-label lists wrap instead of stacking into tall columns.
- Short CTA groups remain rows on tablet, with wrapping; narrow mobile may stack them.
- Symmetric large padding around a single short heading becomes centering.
- Logo/menu grouping stays together beside the header actions; small-screen groups may wrap to preserve readable labels without hiding content.
- Identical padding-cap CSS is not repeated at every smaller breakpoint.

Independent candidate: `.review-work/manual-rules-candidate/merged/bricks-template-import.json`.
No changes to WordPress, no AI calls, and no GitHub pushes.

Validation: 120 tests passed; candidate has 349 elements, 34 assets, zero validation errors/warnings. Local captures at 1440/1024/390/320 had no horizontal overflow or broken images. Header was recaptured and visually inspected after fixing phone-label squeezing. Local previews do not initialize the real WordPress menu or prove live fidelity.

Not generalized: hiding this site's quote CTA on mobile, manually regrouping its photo collage, or treating all images as height 100%. Those edits need semantic/source evidence and live comparison before becoming universal rules.

Keep page 4955 as the manual reference. Do not retry/import into it merely to test these rules: that would replace the user's saved edits. Use the separate candidate for review or a separately authorized staging page.


---

## Source: `README-PREIMPORT-FLOW-2026-10-28.md`

# Pre-import validation and selective browser review

Implemented the requested order using the existing normalization/compiler pipeline, without new permanent model access to compiler code:

1. Existing section-based Codex/API normalization receives measured Figma data, manifest, schema and cropped screenshot. Existing schema validation/repair and source-measurement reconciliation remain active.
2. New `scripts/conversion-audit.js` runs before page import in the pipeline and again after menu binding in app autopilot. It validates normalized sections, validates the compiled build, detects missing normalized text, invalid padding, and possibly lost widths through source mappings. Hard errors block page import. Width warnings are deliberately not blindly rewritten: grid/flex inheritance may legitimately express sizing without direct width properties. Compiler defects still need a source-level fix; this gate does not promise arbitrary automatic compiler repair.
3. After one draft import, shared browser captures are compared section-by-section. Figma reference and frontend are cropped independently by section position, preserving width/height differences without letting earlier sections dominate later section scores.
4. Sections passing pixel/DOM thresholds skip AI. Failing sections receive cropped images and compact settings context without custom CSS or embedded asset payloads. A run has an eight-request/400000-input-character browser review budget, including rejected-proposal retries. Larger context or exhausted budgets become unresolved issues rather than crashes. This is a request/input-size budget, not an exact token or monetary cap.
5. Unchanged candidate trees share captures within each review pass. Final verification uses a fresh shared capture and deterministic checks, not another AI request for every section. Previous unresolved findings prevent acceptance even if the final numeric threshold passes.
6. Accepted sections save subtree fingerprints. Retry copies checkpoints and skips unchanged accepted section AI review, but still runs final browser checks. Budgets reset for each explicitly requested retry.

Usage: normalization request counts plus Codex-returned token usage are recorded in `usage.json`; browser request totals and reported tokens are shown in workflow output. Providers without usage information are excluded. These are not billing estimates and do not prove subscription allowance consumption. No pricing claims.

Tests: full regression suite, targeted static-audit/compact-context/budget/section-crop/checkpoint tests, production TS/Vite build, Playwright UI smoke. Existing source section-08 ran through cropped local comparison without an AI request or context failure. This was LOCAL evidence only: no live WordPress mutation or paid/provider request was made for this implementation validation. No GitHub push.

Next run: refresh Studio UI; child workers load the updated flow on the next conversion/retry. Existing running server can display new workflow summaries without losing its current browser session. API state usage-file and new artifact-route additions require a later server restart, but workflow summaries do not. Do not restart unnecessarily while the user has a connected browser session.

Remaining: numerical screenshot thresholds cannot prove interaction behavior or perfect fidelity. Contexts still exceeding the compact budget are reported, not automatically split. Static audit does not yet compare every Bricks property with effective normalized semantics. Browser-stage bounded corrections still target generated Bricks JSON. Core compiler bug correction remains a separate tested development workflow. A real new-design end-to-end run remains necessary before claiming visual acceptance.


---

## Source: `README-SESSION-HANDOFF-2026-10-16.md`

# Session handoff â€” Figma-to-Bricks clean-build audit

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
| CasinoFX â€” skipped | `https://www.figma.com/design/mMJsY2EiHFk4VaFghaUh4L/CasinoFX-Homepage?node-id=2214-2` | `output/casinofx-homepage`; current token returned 404 during SVG export |
| LaslesVPN â€” skipped | Source URL not supplied | `output/landingpage`; required masks missing, including `1:476` and `1:137` |

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


---

## Source: `README-STUDIO-HANDOFF-2026-10-27.md`

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


---

## Source: `README-STUDIO-HANDOFF-2026-10-28.md`

# Studio one-click continuation â€” 2026-10-28

User requested a visible Codex connection and one-button Figma-to-WordPress workflow. Implemented on top of the previous Studio; no commit/push or live WordPress write.

- Integrations now has `Connect Codex` and explicit Figma token, MCP URL, WordPress username/application-password fields. Supported Codex CLI device authentication writes to ignored `.studio/codex-auth`; challenges stay in memory and clear on successful login. User must approve the OpenAI device sign-in. Existing CLI authentication/API key remains supported.
- New Conversion has `Convert with Codex to WordPress draft`. `autopilot-worker.js` compiles a source URL, makes a job-owned frame copy, binds menus, reviews every compiled section with Codex, carries retained validated changes forward, then passes the corrected tree directly to the existing injector. It never passes a user-selected page ID. Original compiled output is not overwritten by repair.
- Creates a new draft, shows builder link and reviewed JSON download. Maximum 40 sections, 0â€“2 repair rounds each, one-hour overall timeout. No automatic publishing. Menu provisioning can occur before a later review fails; retry may create another draft.
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


---

## Source: `studio\README.md`

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


