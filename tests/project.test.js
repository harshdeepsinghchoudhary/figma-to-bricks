import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { validateBricks } from "../scripts/bricks-validator.js";
import { diffTrees } from "../scripts/dataset-diff.js";
import { applyVisualPatches, validateReview, filterVisualPatches } from "../scripts/visual-patches.js";
import { previewHTML, renderScreenshots } from "../scripts/preview.js";
import { visionConfig, callVision } from "../scripts/vision-client.js";
import { visualReview, cropImage, sectionComparison, comparisonError } from "../scripts/6_visual_review.js";
import { ELEMENT_TEMPLATES } from "../scripts/bricks-schema.js";
import { parseVisualResponse } from "../scripts/visual-response.js";
import { decorationOwner } from "../scripts/section-detect.js";
import { providerHttpError, checkOllama } from "../scripts/provider-health.js";
import { createHash } from "node:crypto";
import { validateBuild } from "../scripts/validate-build.js";

const workRoot = path.resolve(".test-work"); fs.mkdirSync(workRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(workRoot, "run-"));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const tree = () => [
  { id: "aaaaaa", name: "section", parent: 0, children: ["bbbbbb"], settings: { _background: { color: { raw: "#ffffff" } }, _padding: { top: "20", bottom: "20" } } },
  { id: "bbbbbb", name: "container", parent: "aaaaaa", children: ["cccccc", "dddddd"], settings: { _width: "100%", _widthMax: "600px" } },
  { id: "cccccc", name: "heading", parent: "bbbbbb", children: [], settings: { tag: "h1", text: "Visual test", _typography: { "font-size": "32px", color: { raw: "#111111" } } } },
  { id: "dddddd", name: "text-basic", parent: "bbbbbb", children: [], settings: { text: "Example copy" } }
];
const child = (script, args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; p.stdout.on("data", (d) => output += d); p.stderr.on("data", (d) => output += d);
  p.on("error", (e) => resolve({ code: 1, output: e.message })); p.on("close", (code) => resolve({ code, output }));
});
const fixture = (name) => {
  const dir = path.join(work, name);
  const box = { x: 0, y: 0, width: 800, height: 300 };
  const figma = { id: "0:1", name: "Test page", type: "FRAME", absoluteBoundingBox: box, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], children: [{ id: "1:1", name: "Section", type: "FRAME", absoluteBoundingBox: box, children: [{ id: "1:2", type: "TEXT", characters: "Visual test", absoluteBoundingBox: { x: 20, y: 20, width: 250, height: 40 }, style: { fontSize: 32, fontWeight: 700 } }] }] };
  const normalized = { type: "page", children: [{ id: "section", figmaNodeId: "1:1", type: "section", background: { color: "#FFFFFF" }, children: [{ id: "heading", figmaNodeId: "1:2", type: "heading", text: "Visual test", level: 1, typography: { fontSize: 32, color: "#111111" } }] }] };
  write(path.join(dir, "figma-node.json"), figma); write(path.join(dir, "sections.json"), { "1:1": "section-01" });
  write(path.join(dir, "sections", "section-01", "normalized.json"), normalized);
  write(path.join(dir, "asset-manifest.json"), []);
  return dir;
};

test("Bricks validator catches reverse links, duplicates, cycles and malformed children", () => {
  assert.deepEqual(validateBricks(tree()).errors, []);
  for (const mutate of [t => t[1].children.pop(), t => t[1].children.push("cccccc"), t => t[1].children = {}, t => t[1].parent = "cccccc"]) {
    const t = tree(); mutate(t); assert.ok(validateBricks(t).errors.length);
  }
});
test("visual proposals discard no-ops and conflicting fields regardless of ordering", () => {
  const p = value => ({ op: "settings", id: "aaaaaa", set: { _padding: value } });
  const noOp = p({ bottom: "20", top: "20" });
  assert.equal(filterVisualPatches(tree(), [noOp]).patches.length, 0);
  const proposals = [p({ top: "0" }), p({ top: "10" }), { op: "settings", id: "aaaaaa", set: { _height: "100" } }];
  assert.deepEqual(filterVisualPatches(tree(), proposals).patches, filterVisualPatches(tree(), proposals.reverse()).patches);
  assert.equal(filterVisualPatches(tree(), proposals).patches.length, 1);
});

test("vision JSON punctuation is repaired but invalid IDs/schema remain rejected", () => {
  const ids = new Set(["aaaaaa"]);
  const text = '```json\n{"issues":[],"patches":[{"op":"settings","id":"aaaaaa","set":{"_padding":{"top":"16"}}}]\n```';
  const parsed = parseVisualResponse(text, ids); assert.equal(parsed.repaired, true); assert.equal(parsed.review.patches[0].id, "aaaaaa");
  assert.throws(() => parseVisualResponse('{"issues":[],"patches":[{"id":"xxxxxx"}]}', ids), /Unknown/);
  assert.throws(() => parseVisualResponse('{"issues":"none","patches":[]}', ids), /issues/);
});
test("quota errors expose the provider retry time and daily scope", () => {
  const e = providerHttpError("groq", 429, JSON.stringify({ error: { message: "tokens per day (TPD): Limit 200000, Used 195315, Requested 6120. Please try again in 10m19.92s." } }));
  assert.equal(e.code, "RATE_LIMITED"); assert.equal(e.quotaScope, "daily"); assert.equal(e.retryAfterSeconds, 619.92);
  assert.equal(providerHttpError("groq", 429, "limit", "65").retryAfterSeconds, 65);
});
test("Ollama setup distinguishes unreachable servers and text-only models", async () => {
  const config = { host: "http://localhost:11434", model: "test" };
  await assert.rejects(checkOllama(config, async () => { throw new Error("refused"); }), /does not establish a GPU incompatibility/);
  await assert.rejects(checkOllama(config, async () => new Response(JSON.stringify({ capabilities: ["completion"] }))), /does not report vision/);
  assert.equal((await checkOllama(config, async () => new Response(JSON.stringify({ capabilities: ["completion", "vision"] })))).vision, true);
});
test("Groq quota falls back to Ollama with both images and preserves quota errors if local inference fails", async () => {
  let localFails = false, localCalls = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/chat") {
      localCalls++; assert.equal(body.messages[0].images.length, 2);
      if (localFails) { res.statusCode = 503; res.end(JSON.stringify({ error: "model unavailable" })); }
      else res.end(JSON.stringify({ message: { content: '{"issues":[],"patches":[]}' } }));
    } else { res.statusCode = 429; res.end(JSON.stringify({ error: { message: "tokens per day (TPD). Please try again in 10m." } })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${server.address().port}`, config = { provider: "groq", model: "test", key: "test", endpoint: host };
  const previous = { host: process.env.OLLAMA_HOST, model: process.env.OLLAMA_VISION_MODEL };
  process.env.OLLAMA_HOST = host; process.env.OLLAMA_VISION_MODEL = "test-local";
  try {
    const response = await callVision("Compare two images; respond in JSON.", ["first", "second"], config);
    assert.equal(response.provider, "ollama"); assert.equal(localCalls, 1);
    localFails = true;
    await assert.rejects(callVision("Compare two images.", ["first", "second"], config), (e) => e.code === "RATE_LIMITED" && e.quotaScope === "daily" && /fallback also failed/.test(e.message));
  } finally {
    if (previous.host === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = previous.host;
    if (previous.model === undefined) delete process.env.OLLAMA_VISION_MODEL; else process.env.OLLAMA_VISION_MODEL = previous.model;
    await new Promise((resolve) => server.close(resolve));
  }
});
test("contained decorative leaves are not extra sections; independent shapes/images remain", () => {
  const owner = { id: "1", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 }, children: [{ type: "TEXT", characters: "Content" }] };
  const leaf = { id: "2", type: "RECTANGLE", absoluteBoundingBox: { x: 20, y: 20, width: 100, height: 100 } };
  assert.equal(decorationOwner(leaf, [owner, leaf]), owner);
  assert.equal(decorationOwner({ ...leaf, absoluteBoundingBox: { ...leaf.absoluteBoundingBox, x: 600 } }, [owner]), null);
  assert.equal(decorationOwner({ ...leaf, fills: [{ type: "IMAGE" }] }, [owner]), null);
});
test("human diff catches child order and type changes without object-key noise", () => {
  const a = tree(), b = tree(); b[1].children.reverse(); b[2].name = "text-basic";
  b[0].settings = { _padding: { bottom: "20", top: "20" }, _background: { color: { raw: "#ffffff" } } };
  const diff = diffTrees(a, b); assert.equal(diff.changed.length, 2); assert.ok(diff.changed[0].children); assert.ok(diff.changed[1].elementType);
});
test("visual patches reject missing assets, unknown IDs, CSS injection and cycles", () => {
  for (const patches of [
    [{ op: "settings", id: "cccccc", set: { _cssCustom: "body{}" } }],
    [{ op: "settings", id: "cccccc", set: { image: { url: "invented.png" } } }],
    [{ op: "settings", id: "cccccc", set: { _width: "10px;display:none" } }],
    [{ op: "settings", id: "xxxxxx", set: { _width: "10" } }],
    [{ op: "move", id: "bbbbbb", parent: "bbbbbb", index: 0 }],
    [{ op: "reorder", id: "bbbbbb", children: ["cccccc"] }]
  ]) assert.throws(() => applyVisualPatches(tree(), patches));
  const patched = applyVisualPatches(tree(), [{ op: "settings", id: "aaaaaa", set: { _padding: { top: "30" } } }, { op: "reorder", id: "bbbbbb", children: ["dddddd", "cccccc"] }]);
  assert.equal(patched[0].settings._padding.top, "30"); assert.equal(tree()[0].settings._padding.top, "20");
  assert.throws(() => validateReview({ issues: [], patches: [{ id: "xxxxxx" }] }, new Set(["aaaaaa"])));
});
test("button layout emits the keys accepted by Bricks", () => {
  const button = ELEMENT_TEMPLATES.button({ id: "button", text: "Click", layout: { direction: "row", gap: 8 } });
  assert.equal(button.settings._direction, undefined); assert.equal(button.settings._rowGap, undefined); assert.equal(button.settings._columnGap, undefined);
  assert.equal(button.settings._flexDirection, "row"); assert.equal(button.settings.iconGap, "8");
});
test("preview embeds original assets, pseudo breakpoints, and fails for missing media", async () => {
  const file = path.join(work, "asset.png"); await sharp({ create: { width: 20, height: 20, channels: 4, background: "red" } }).png().toFile(file);
  const t = tree(); t[0].settings._background.image = { url: "asset.png" }; t[0].settings["_position:mobile_landscape::before"] = "absolute";
  const html = previewHTML(t, work); assert.match(html, /data:image\/png;base64/); assert.match(html, /@media\(max-width:767px\).*::before\{position:absolute/);
  t[0].settings._background.image.url = "missing.png"; assert.throws(() => previewHTML(t, work), /missing/);
});

test("compilation produces stable IDs and valid links", async () => {
  const dir = fixture("compile"); const section = path.join(dir, "sections", "section-01");
  const first = await child("scripts/3_compile_bricks.js", [section]); assert.equal(first.code, 0, first.output);
  const a = fs.readFileSync(path.join(section, "bricks-tree.json"), "utf8");
  const second = await child("scripts/3_compile_bricks.js", [section]); assert.equal(second.code, 0, second.output);
  assert.equal(fs.readFileSync(path.join(section, "bricks-tree.json"), "utf8"), a); assert.deepEqual(validateBricks(JSON.parse(a)).errors, []);
  const relocated = path.join(work, "relocated-compile"); fs.cpSync(dir, relocated, { recursive: true });
  const movedSection = path.join(relocated, "sections", "section-01");
  const moved = await child("scripts/3_compile_bricks.js", [movedSection]); assert.equal(moved.code, 0, moved.output);
  assert.equal(fs.readFileSync(path.join(movedSection, "bricks-tree.json"), "utf8"), a);
});
test("failed section cannot reuse stale tree during merge", async () => {
  const dir = fixture("stale"); const section = path.join(dir, "sections", "section-01");
  write(path.join(section, "bricks-tree.json"), tree()); write(path.join(section, "normalized.json"), { invalid: true });
  const result = await child("scripts/run-sections.js", [dir]); assert.equal(result.code, 1);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "build-report.json"))); assert.equal(report.merged, false); assert.deepEqual(report.failedSections, ["section-01"]);
});
test("pipeline builds cached sections without model calls and records failures truthfully", async () => {
  const dir = fixture("pipeline");
  const ok = await child("scripts/pipeline.js", ["--frame", dir, "--no-inject"], { VISUAL_PROVIDER: "invalid-provider", BROWSER_EXECUTABLE: "missing-browser" }); assert.equal(ok.code, 0, ok.output);
  const run = fs.readdirSync(path.join(dir, "runs"))[0]; const report = JSON.parse(fs.readFileSync(path.join(dir, "runs", run, "run.json")));
  assert.equal(report.exitCode, 0); assert.ok(fs.existsSync(path.join(dir, "runs", run, "dataset", "page.json")));
  assert.equal(report.visualDebugging, "manual-only; never invoked by the pipeline");
  assert.equal(report.steps.some(s => /visual|measure|preview/.test(s.script)), false);
  assert.ok(report.steps.some(s => s.script === "validate-build.js"));
  const failed = await child("scripts/pipeline.js", ["--frame", dir, "--no-visual", "--page", "123"], { WP_API_URL: "", WP_API_USERNAME: "", WP_API_PASSWORD: "" });
  assert.equal(failed.code, 1, failed.output); assert.match(failed.output, /Missing in .env/);
  const log = fs.readFileSync(path.join(dir, "runs", fs.readdirSync(path.join(dir, "runs")).sort().at(-1), "run.log"), "utf8"); assert.match(log, /Finished with failures/);
});
test("manual visual debugging rejects unreported or unscoped runs before rendering", async () => {
  await assert.rejects(visualReview("nonexistent"), /one --only section/);
  await assert.rejects(visualReview("nonexistent", { only: ["a", "b"], problem: "Overlap", localPreview: true }), /one --only/);
  await assert.rejects(visualReview("nonexistent", { only: ["a"], problem: "Overlap" }), /--page-url/);
  await assert.rejects(visualReview("nonexistent", { only: ["a"], problem: "Overlap", localPreview: true, iterations: 2 }), /one targeted correction/);
});
test("nonvisual validation rejects unknown native settings and missing local assets", () => {
  const doc = tree();
  doc[0].settings._invented = "yes";
  assert.ok(validateBuild(doc, work).errors.some(e => /unsupported setting/.test(e)));
  delete doc[0].settings._invented;
  doc[0].settings._cssGlobalClasses = ["unknown-class-id"];
  assert.ok(validateBuild(doc, work).errors.some(e => /global class.*saved site/.test(e)));
  delete doc[0].settings._cssGlobalClasses;
  doc.push({ id: "eeeeee", name: "image", parent: "bbbbbb", children: [], settings: { image: { id: 0, filename: "missing.png", size: "full", full: "missing.png", url: "missing.png" } } });
  doc[1].children.push("eeeeee");
  assert.ok(validateBuild(doc, work).errors.some(e => /Missing media/.test(e)));
});
test("measurement failures return nonzero instead of passing the QA gate", async () => {
  const repo = path.join(work, "measurement-tools");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  for (const script of ["dom-measure.js", "overflow-sweep.js"]) fs.writeFileSync(path.join(repo, "scripts", script), "process.exit(1);");
  const result = await child("scripts/5_measure.js", [work, "http://localhost/", ".test"], { SKILL_REPO_PATH: repo });
  assert.equal(result.code, 1, result.output);
});
test("dataset snapshots preserve earlier human edits without exporting them as current", async () => {
  const dir = fixture("dataset");
  write(path.join(dir, "merged", "bricks-tree.json"), tree());
  write(path.join(dir, "dataset", "wp-final.json"), tree());
  write(path.join(dir, "dataset", "human-diff.json"), { previous: true });
  write(path.join(dir, "dataset", "page.json"), { wordpressPageId: 123 });
  const result = await child("scripts/export-dataset.js", [dir]); assert.equal(result.code, 0, result.output);
  assert.equal(fs.existsSync(path.join(dir, "dataset", "wp-final.json")), false);
  const history = path.join(dir, "dataset", "human-history"); const capture = fs.readdirSync(history)[0];
  assert.equal(JSON.parse(fs.readFileSync(path.join(history, capture, "human-diff.json"))).previous, true);
  write(path.join(dir, "sections", "excluded-shape", "normalized.json"), { type: "page", children: [] });
  write(path.join(dir, "merged", "section-map.json"), [{ name: "section-01" }]);
  const filtered = await child("scripts/export-dataset.js", [dir]); assert.equal(filtered.code, 0, filtered.output);
  const records = fs.readFileSync(path.join(dir, "dataset", "sections.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((r) => r.section), ["section-01"]);
});

test("vision config requires a model and never invents a text-only fallback", () => {
  assert.throws(() => visionConfig({ VISUAL_PROVIDER: "ollama" }), /model/i);
  assert.equal(visionConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "test" }).model, "qwen/qwen3.8-27b");
  assert.equal(visionConfig({ GROQ_API_KEY: "test" }).provider, "groq");
  assert.equal(visionConfig({ VISUAL_PROVIDER: "ollama", OLLAMA_MODEL: "text-model", OLLAMA_VISION_MODEL: "image-model" }).model, "image-model");
});

test.after(() => {
  if (!work.startsWith(workRoot + path.sep)) throw new Error("Refusing test cleanup outside workspace.");
  fs.rmSync(work, { recursive: true, force: true });
});
