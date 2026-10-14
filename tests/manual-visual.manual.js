// Explicit manual-tool tests; excluded from npm test. Do not run during normal generation.
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

test("whole-section images retain background and shared scale instead of stretching", async () => {
  const a = path.join(work, "dark.png"), b = path.join(work, "yellow.png");
  await sharp({ create: { width: 800, height: 80, channels: 3, background: "#323947" } }).png().toFile(a);
  await sharp({ create: { width: 800, height: 160, channels: 3, background: "#ffff00" } }).png().toFile(b);
  const pair = await sectionComparison(a, b, { x: 0, y: 0, width: 800, height: 80 }, { x: 0, y: 0, width: 800, height: 160 });
  const m = await sharp(pair.reference).metadata(), n = await sharp(pair.actual).metadata();
  assert.equal(m.width, n.width); assert.equal(m.height, n.height); assert.equal(m.height, 128);
  assert.ok(await comparisonError(pair.reference, pair.actual) > 30);
  const pixel = await sharp(pair.reference).extract({ left: 10, top: 10, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel], [50, 57, 71]);
});
test("small and thin screenshot crops meet the provider minimum without stretching", async () => {
  const file = path.join(work, "crop-source.png");
  await sharp({ create: { width: 100, height: 100, channels: 4, background: "red" } }).png().toFile(file);
  for (const rect of [{ x: 0, y: 0, width: 14, height: 16 }, { x: 0, y: 0, width: 100, height: 1 }, { x: 0, y: 0, width: 1, height: 100 }]) {
    const result = await cropImage(file, rect); const meta = await sharp(result).metadata();
    assert.equal(meta.width, Math.max(32, rect.width)); assert.equal(meta.height, Math.max(32, rect.height));
    const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) redPixels++;
    assert.equal(redPixels, rect.width * rect.height);
  }
});
test("Ollama receives two images; visual correction re-renders and rejects regression", async () => {
  const dir = fixture("visual"); write(path.join(dir, "merged", "bricks-tree.json"), tree());
  write(path.join(dir, "merged", "section-map.json"), [{ name: "section-01", figmaNodeId: "1:1", rootIds: ["aaaaaa"] }]);
  await sharp({ create: { width: 800, height: 300, channels: 4, background: "white" } }).png().toFile(path.join(dir, "screenshot.png"));
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); assert.equal(body.messages[0].images.length, 2); calls++;
    const value = calls === 1 ? { issues: [{ severity: "medium", elementId: "aaaaaa", description: "Padding too small" }], patches: [{ op: "settings", id: "aaaaaa", set: { _padding: { top: "30", bottom: "20" } } }] }
      : calls === 2 ? { issues: [], patches: [] } : { issues: [{ severity: "high", description: "Regression" }], patches: [] };
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message: { content: calls === 1 ? JSON.stringify(value).slice(0, -1) : JSON.stringify(value) }, done_reason: "stop" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = { provider: "ollama", model: "test-vision", host: `http://127.0.0.1:${server.address().port}` };
  try {
    const response = await visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config, fix: true, iterations: 1 }); assert.equal(response.ok, true); assert.equal(calls, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "merged", "bricks-tree.json")))[0].settings._padding.top, "30");
    assert.ok(response.report.corrected);
    assert.equal(response.report.rounds[0].sections[0].repairedJSON, true);
    const cached = await visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config, iterations: 0 }); assert.equal(cached.ok, true); assert.equal(calls, 2); assert.equal(cached.report.rounds[0].sections[0].cacheHit, true);
    calls = 0;
    server.removeAllListeners("request");
    server.on("request", async (req, res) => { for await (const ignored of req) {} calls++; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify({ issues: [{ severity: calls === 1 ? "medium" : "high", description: "Remaining difference" }], patches: [{ op: "settings", id: "aaaaaa", set: { _padding: { top: "100" } } }] }) } })); });
    const original = fs.readFileSync(path.join(dir, "merged", "bricks-tree.json"), "utf8");
    const regression = await visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config: { ...config, model: "test-regression" }, fix: true, iterations: 1 }); assert.equal(regression.ok, false); assert.equal(regression.report.acceptedRound, 0);
    assert.equal(fs.readFileSync(path.join(dir, "merged", "bricks-tree.json"), "utf8"), original);
    calls = 0;
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      for await (const ignored of req) {} calls++;
      const review = calls === 1 ? { issues: [{ severity: "medium", description: "Model incorrectly claims the matching white background is missing" }], patches: [{ op: "settings", id: "aaaaaa", set: { _background: { color: { raw: "#000000" } } } }] } : { issues: [], patches: [] };
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify(review) } }));
    });
    const hallucinated = await visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config: { ...config, model: "test-background-hallucination" }, fix: true, iterations: 1 });
    assert.equal(hallucinated.report.acceptedRound, 0);
    assert.match(hallucinated.report.rounds[0].sections[0].scopeRejected[0].reason, /appearance/);
    assert.equal(fs.readFileSync(path.join(dir, "merged", "bricks-tree.json"), "utf8"), original);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("daily quota checkpoints prevent repeated provider requests during cooldown", async () => {
  const dir = fixture("quota"); write(path.join(dir, "merged", "bricks-tree.json"), tree());
  write(path.join(dir, "merged", "section-map.json"), [{ name: "section-01", figmaNodeId: "1:1", rootIds: ["aaaaaa"] }]);
  await sharp({ create: { width: 800, height: 300, channels: 4, background: "white" } }).png().toFile(path.join(dir, "screenshot.png"));
  let calls = 0;
  const server = http.createServer(async (req, res) => { for await (const ignored of req) {} calls++; res.statusCode = 429; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: { message: "tokens per day (TPD). Please try again in 10m19.92s." } })); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = { provider: "groq", model: "test-quota", key: work, endpoint: `http://127.0.0.1:${server.address().port}` };
  const key = createHash("sha256").update(`${config.provider}|${config.model}|${config.key}`).digest("hex");
  const stateFile = path.resolve("output", "provider-state", `${key}.json`);
  const fallbackBefore = process.env.OLLAMA_VISION_MODEL; delete process.env.OLLAMA_VISION_MODEL;
  try {
    await assert.rejects(visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config, iterations: 0 }), (e) => e.code === "RATE_LIMITED"); assert.equal(calls, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "merged", "visual-report.json"))).status, "waiting-for-provider");
    await assert.rejects(visualReview(dir, { only: ["section-01"], problem: "Reported container padding is incorrect", localPreview: true, config, iterations: 0 }), /cooling down/); assert.equal(calls, 1);
  } finally { if (fallbackBefore === undefined) delete process.env.OLLAMA_VISION_MODEL; else process.env.OLLAMA_VISION_MODEL = fallbackBefore; if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); await new Promise((resolve) => server.close(resolve)); }
});

test.after(() => {
  if (!work.startsWith(workRoot + path.sep)) throw new Error("Refusing test cleanup outside workspace.");
  fs.rmSync(work, { recursive: true, force: true });
});
