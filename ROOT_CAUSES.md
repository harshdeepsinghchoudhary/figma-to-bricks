# Why the compiler keeps getting layouts wrong - root causes (for discussion)

1. **The model step is not repeatable.** `2_normalize` is an LLM. The same Figma frame yields a different tree on each run (hero with/without
   image, a column dropped, a fill copied). Fixes made for one run's mistakes do not apply to the next run's different mistakes. This is why
   "the first result was good, later ones got worse".
2. **The model sees a pruned, flattened summary of Figma**, not the truth: switched-off fills, mask shapes, group boundaries and exact
   geometry are lost or ambiguous. It then guesses (grey mask -> a grey div; hidden white fill -> white pill).
3. **Nothing checked the model's output against Figma.** The old compiler trusted every fill, size, padding and "unsupported" it was given.
   The new rules re-derive these from geometry (fills, padding, missing text/icons, grids) and so are independent of the model's mood.
4. **The extractor decides what exists.** A size limit (700px) silently dropped the curve line. Anything not exported can never appear,
   however good the compiler is.
5. **Fixes were applied one symptom at a time**, in different files (normalize, structure, responsive, schema, merge). Each file made
   assumptions the others did not know (e.g. a grid's width, an absolute layer, a full-width strip), so a correct change in one broke
   another (the grid squeeze, the layer rendered at the top of the page).
6. **No regression measure.** There was no render + compare step, so a change could improve one section and break ten unseen. The harness
   in `tools/` now gives a number per section and per breakpoint.
7. **Bricks-specific semantics** (a container is not full width, `align-items` does not stretch when set to a side, pseudo-elements need
   per-breakpoint position, a full-screen line must sit outside the site container) are conventions that live in your hand-made file, not in
   the compiler. They have to be encoded as rules one by one.

Decision for you: (a) keep the LLM but make it a *proposal* that geometry rules always reconcile (what these rounds did), or (b) make the
structure fully deterministic from Figma auto-layout/geometry and use the LLM only for naming, heading levels and copy.
