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