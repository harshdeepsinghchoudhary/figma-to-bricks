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
