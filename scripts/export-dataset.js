/**
 * Save everything one run produced as a dataset for training or evaluating a model later.
 *
 *   node scripts/export-dataset.js output/<frame> [--page <id>] [--sync]
 *
 * Writes output/<frame>/dataset/:
 *   sections.jsonl   one line per section: the exact model INPUT (prompt-figma.json), the model's raw answer (when saved),
 *                    the validated normalized JSON, and the compiled Bricks elements for that section
 *   pairs.jsonl      figma -> bricks pairs per section: { input, normalized, bricks_compiler }
 *   page.json        the page as pushed: merged Bricks tree, template-import path, WordPress page id, asset manifest, source URL
 *   screenshot.png   the Figma screenshot (visual reference)
 *   wp-final.json    (only with --sync) the page as it is NOW in WordPress, i.e. after human edits in the builder
 *   human-diff.json  (only with --sync) how the final page differs from what the compiler pushed (the training signal)
 *
 * --sync needs .env (WP_API_*) and fetches the elements with the bricks/get-page-elements ability through test-mcp.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const frameDir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--page");
const pi = args.indexOf("--page");
const pageId = pi >= 0 ? Number(args[pi + 1]) : null;
if (!frameDir || !fs.existsSync(frameDir)) { console.error("Usage: node scripts/export-dataset.js output/<frame> [--page <id>] [--sync]"); process.exit(1); }

const rd = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : null);
const out = path.join(frameDir, "dataset");
fs.mkdirSync(out, { recursive: true });
const secRoot = path.join(frameDir, "sections");
const names = rd(path.join(frameDir, "sections.json")) || {};
const byName = Object.fromEntries(Object.entries(names).map(([id, n]) => [n, id]));
const frame = path.basename(frameDir);

const lines = [], pairs = [];
for (const d of fs.existsSync(secRoot) ? fs.readdirSync(secRoot).sort() : []) {
  const dir = path.join(secRoot, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  const normalized = rd(path.join(dir, "normalized.json"));
  if (!normalized) continue;
  const input = rd(path.join(dir, "prompt-figma.json"));
  const bricks = rd(path.join(dir, "bricks-tree.json"));
  const rawFile = path.join(dir, "normalized.raw.txt");
  const rec = {
    schema: 1, frame, section: d, figmaNodeId: byName[d] || null,
    input_figma: input, model_raw_output: fs.existsSync(rawFile) ? fs.readFileSync(rawFile, "utf8") : null,
    rejected_attempt: rd(path.join(dir, "normalized.rejected.json")),
    normalized, bricks_compiler: bricks,
    counts: { bricksElements: bricks?.length ?? null },
  };
  lines.push(JSON.stringify(rec));
  pairs.push(JSON.stringify({ section: d, input: input, normalized, bricks_compiler: bricks }));
}
fs.writeFileSync(path.join(out, "sections.jsonl"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(out, "pairs.jsonl"), pairs.join("\n") + "\n");

const merged = rd(path.join(frameDir, "merged", "bricks-tree.json"));
const src = rd(path.join(frameDir, "source.json"));
const page = {
  schema: 1, frame, exportedAt: new Date().toISOString(), figmaUrl: src?.figmaUrl ?? null, wordpressPageId: pageId,
  bricks_compiler_tree: merged, template_import: path.join(frameDir, "merged", "bricks-template-import.json"),
  asset_manifest: rd(path.join(frameDir, "asset-manifest.json")), sections: Object.values(names),
};
fs.writeFileSync(path.join(out, "page.json"), JSON.stringify(page, null, 2));
const shot = path.join(frameDir, "screenshot.png");
if (fs.existsSync(shot)) fs.copyFileSync(shot, path.join(out, "screenshot.png"));
console.log(`Dataset: ${lines.length} section record(s) -> ${path.join(out, "sections.jsonl")}, pairs.jsonl, page.json`);

// ---- optional: capture the human-edited page from WordPress ----
if (args.includes("--sync")) {
  if (!pageId) { console.error("--sync needs --page <id>"); process.exit(1); }
  const a = path.join("output", "sync-args.json");
  fs.writeFileSync(a, JSON.stringify({ postId: pageId }));
  const r = spawnSync(process.execPath, ["scripts/test-mcp.mjs", "run", "bricks/get-page-elements", "@" + a], { stdio: "inherit" });
  const res = rd(path.join("output", "run-bricks_get-page-elements.json"));
  if (r.status !== 0 || !res) { console.error("Could not read the page from WordPress (see above)."); process.exit(1); }
  const find = (x) => { if (Array.isArray(x) && x.length && x[0]?.id && x[0]?.name) return x; if (x && typeof x === "object") for (const v of Object.values(x)) { const r2 = find(v); if (r2) return r2; } return null; };
  const final = find(res) || [];
  fs.writeFileSync(path.join(out, "wp-final.json"), JSON.stringify(final, null, 2));
  // what the human changed, by element: settings keys added/removed/changed on matching ids, plus added/removed elements
  const A = new Map((merged || []).map((e) => [e.id, e])), B = new Map(final.map((e) => [e.id, e]));
  const diff = { added: [], removed: [], changed: [] };
  for (const [id, e] of B) { if (!A.has(id)) { diff.added.push(e); continue; } const o = A.get(id); const keys = new Set([...Object.keys(o.settings || {}), ...Object.keys(e.settings || {})]); const ch = {}; for (const k of keys) if (JSON.stringify(o.settings?.[k]) !== JSON.stringify(e.settings?.[k])) ch[k] = { before: o.settings?.[k] ?? null, after: e.settings?.[k] ?? null }; if (Object.keys(ch).length || o.parent !== e.parent) diff.changed.push({ id, name: e.name, parent: o.parent !== e.parent ? { before: o.parent, after: e.parent } : undefined, settings: ch }); }
  for (const [id, e] of A) if (!B.has(id)) diff.removed.push(e);
  fs.writeFileSync(path.join(out, "human-diff.json"), JSON.stringify(diff, null, 2));
  console.log(`Synced ${final.length} element(s) from page ${pageId}: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed -> dataset/wp-final.json, human-diff.json`);
}