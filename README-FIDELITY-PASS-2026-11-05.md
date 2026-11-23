# Fidelity repair checkpoint — 2026-11-05

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
