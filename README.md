# Figma → Bricks Prototype

Milestone 1 pipeline: one Figma frame → normalized design JSON (via LLM) →
Bricks JSON → import into WordPress/Bricks → measure against Figma → iterate.

## Pipeline stages

```
1_extract_figma.js      Figma REST API  -> figma-node.json + assets/*
2_normalize.js          figma-node.json + screenshot + examples -> normalized.json  (LLM)
3_compile_bricks.js     normalized.json -> bricks-tree.json                          (deterministic)
4_inject.js             bricks-tree.json -> writes _bricks_page_content_2 via WP REST
5_measure.js            wraps dom-measure.js: rendered page vs figma-geom.py output
```

Run them in order, or `node run-all.js <figma-url> <wp-page-id>`.

## Setup

```bash
npm install
cp .env.example .env
# fill in FIGMA_TOKEN, ANTHROPIC_API_KEY, WP_BASE_URL, WP_APP_USER, WP_APP_PASSWORD
```

### 1. Figma token
Figma → Settings → Personal access tokens → generate. Needs read access to the file.

### 2. WordPress Application Password
wp-admin → Users → your profile → Application Passwords → create one named
`figma-to-bricks`. Needed to push page content via the REST API without exposing
your real login password. Requires an admin/editor role.

### 3. Seed examples (critical — do this before running the LLM step)
Drop 3-5 of your real Figma → Bricks pairs into `examples/`:

```
examples/
  hero-01/
    figma-node.json      (raw Figma API response for that frame, or just the relevant excerpt)
    bricks-export.json   (the real _bricks_page_content_2 value for that section)
  card-grid-01/
    figma-node.json
    bricks-export.json
  ...
```

These are what make step 2 reliable — the LLM is shown real paired examples of
"this Figma structure" -> "this normalized shape", not asked to invent Bricks
syntax from a description. See `examples/README.md`.

### 4. Bricks schema (fill this in from your real exports — see below)
`3_compile_bricks.js` currently ships with placeholder mappings for a handful of
common elements (section, container, heading, text, button, image). Before this
will produce valid output for YOUR site, you need to walk through 2-3 of your
real `bricks-export.json` files and correct `bricks-schema.js` to match exactly
what Bricks expects (required keys, default settings, your actual global class
names). This is Phase 0 from the earlier roadmap — do it by inspection, not by
guessing. I've left `// VERIFY AGAINST YOUR EXPORTS` markers everywhere this matters.

## What this prototype deliberately does NOT do yet
- No auto-correction loop (step 5 produces a diff report; you or a second LLM
  call decide the fix — wiring that up is milestone 2)
- No component-reuse detection ("this looks like our Card component")
- Single frame/section at a time, not full pages
- No Elementor/Gutenberg targets — Bricks only, per your priority
