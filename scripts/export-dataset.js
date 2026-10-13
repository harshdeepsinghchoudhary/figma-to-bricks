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
import { diffTrees } from "./dataset-diff.js";
import { validateBricks } from "./bricks-validator.js";

const args = process.argv.slice(2);
const frameDir = args.find((a, i) => !a.startsWith("--") && !["--page", "--run"].includes(args[i - 1]));
const pi = args.indexOf("--page");
const pageId = pi >= 0 ? Number(args[pi + 1]) : null;
const runIndex = args.indexOf("--run");
const runDir = runIndex >= 0 ? args[runIndex + 1] : null;
if (pi >= 0 && (!Number.isInteger(pageId) || pageId < 1)) throw new Error("--page must be a positive post ID.");
if (runIndex >= 0 && (!runDir || !fs.existsSync(runDir))) throw new Error("--run needs an existing run directory.");
if (!frameDir || !fs.existsSync(frameDir)) { console.error("Usage: node scripts/export-dataset.js output/<frame> [--page <id>] [--sync]"); process.exit(1); }

const rd = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : null);
const out = path.join(frameDir, "dataset");
fs.mkdirSync(out, { recursive: true });
// Keep earlier human edits before replacing the current dataset with an unsynced run.
if (!args.includes("--sync") && ["wp-final.json", "human-diff.json"].some((f) => fs.existsSync(path.join(out, f)))) {
  const history = path.join(out, "human-history", new Date().toISOString().replace(/[:.]/g, "-")); fs.mkdirSync(history, { recursive: true });
  for (const file of ["page.json", "wp-final.json", "human-diff.json"]) if (fs.existsSync(path.join(out, file))) {
    fs.copyFileSync(path.join(out, file), path.join(history, file));
    if (file !== "page.json") fs.unlinkSync(path.join(out, file));
  }
}
const secRoot = path.join(frameDir, "sections");
const names = rd(path.join(frameDir, "sections.json")) || {};
const byName = Object.fromEntries(Object.entries(names).map(([id, n]) => [n, id]));
const frame = path.basename(frameDir);
const mergedSections = rd(path.join(frameDir, "merged", "section-map.json"));
const includedSections = mergedSections ? new Set(mergedSections.map((s) => s.name)) : null;

const lines = [], pairs = [];
for (const d of fs.existsSync(secRoot) ? fs.readdirSync(secRoot).sort() : []) {
  if (includedSections && !includedSections.has(d)) continue;
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
const baselineDir = runDir || path.join(frameDir, "merged");
const injectedReport = rd(path.join(baselineDir, "inject-report.json"));
const injected = injectedReport?.postId === pageId ? rd(path.join(baselineDir, "injected-tree.json")) : null;
const baseline = injected || (runDir ? rd(path.join(runDir, "compiled-tree.json")) : merged);
const src = rd(path.join(frameDir, "source.json"));
const page = {
  schema: 1, frame, exportedAt: new Date().toISOString(), figmaUrl: src?.figmaUrl ?? null, wordpressPageId: pageId,
  bricks_compiler_tree: merged, template_import: path.join(frameDir, "merged", "bricks-template-import.json"),
  bricks_injected_tree: injected, diffBaseline: injected ? "injected" : "compiler", run: runDir,
  asset_manifest: rd(path.join(frameDir, "asset-manifest.json")), sections: includedSections ? [...includedSections] : Object.values(names),
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
  const final = find(res);
  if (!final || res?.success === false || res?.error) throw new Error("WordPress returned no recognizable element array; human diff was not written.");
  const validation = validateBricks(final);
  if (validation.errors.length) throw new Error(`WordPress tree is invalid: ${validation.errors.join("; ")}`);
  // what the human changed, by element: settings keys added/removed/changed on matching ids, plus added/removed elements
  if (!baseline) throw new Error("No captured baseline exists for the human diff.");
  const diff = diffTrees(baseline, final);
  diff.baseline = injected ? "injected" : "compiler (injected snapshot unavailable)";
  fs.writeFileSync(path.join(out, "wp-final.json"), JSON.stringify(final, null, 2));
  fs.writeFileSync(path.join(out, "human-diff.json"), JSON.stringify(diff, null, 2));
  console.log(`Synced ${final.length} element(s) from page ${pageId}: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed -> dataset/wp-final.json, human-diff.json`);
}
if (runDir) {
  const snapshot = path.join(runDir, "dataset"); fs.mkdirSync(snapshot, { recursive: true });
  for (const file of fs.readdirSync(out)) if (fs.statSync(path.join(out, file)).isFile()) fs.copyFileSync(path.join(out, file), path.join(snapshot, file));
}
