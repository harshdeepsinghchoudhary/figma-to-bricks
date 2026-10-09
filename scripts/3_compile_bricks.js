/**
 * Stage 3: normalized.json -> Bricks JSON (deterministic, no LLM)
 *
 * Usage:
 *   node scripts/3_compile_bricks.js output/<frame-name>
 *
 * Reads normalized.json + asset-manifest.json, walks the tree, and produces
 * bricks-tree.json — a flat array in the shape Bricks stores in
 * `_bricks_page_content_2` (see bricks-schema.js for the caveats on that shape).
 *
 * This is intentionally boring, readable code. If the compiler produces wrong
 * output, the fix belongs in bricks-schema.js (correct the mapping), not in
 * prompting the LLM harder — that's the whole point of splitting these stages.
 */
import fs from "node:fs";
import path from "node:path";
import { ELEMENT_TEMPLATES, makeId } from "./bricks-schema.js";
import { validateNormalized } from "./normalized-validator.js";
import { responsify } from "./responsive-pass.js";

const frameDir = process.argv[2];
if (!frameDir) {
  console.error("Usage: node scripts/3_compile_bricks.js output/<frame-name>");
  process.exit(1);
}

const normalizedPath = path.join(frameDir, "normalized.json");
const manifestPath = path.join(frameDir, "asset-manifest.json");

if (!fs.existsSync(normalizedPath)) {
  console.error(`Missing ${normalizedPath} — run stage 2 first.`);
  process.exit(1);
}

const normalized = JSON.parse(fs.readFileSync(normalizedPath, "utf-8"));
// Scoped section folders (output/<frame>/sections/<name>) may have no manifest of their own; fall back to the
// full-page one in the parent frame folder. Asset paths are rewritten relative to frameDir so stage 4 finds the files.
let assetManifest = [];
{
  const candidates = [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")];
  for (const dir of candidates) {
    const mp = path.join(dir, "asset-manifest.json");
    if (!fs.existsSync(mp)) continue;
    const raw = JSON.parse(fs.readFileSync(mp, "utf-8"));
    // skip a manifest whose files don't resolve from its own folder (e.g. a full-page copy sitting in a section folder)
    if (raw.length && !raw.some((a) => fs.existsSync(path.resolve(dir, a.file)))) continue;
    assetManifest = raw.map((a) => {
      const abs = path.resolve(dir, a.file);
      return { ...a, file: path.relative(frameDir, abs).split(path.sep).join("/") };
    });
    break;
  }
}

// asset._resolvedAssetUrl is left as a local file path here — stage 4 (WP
// injection) is responsible for uploading to the WP Media Library and
// swapping this for a real attachment id/URL before writing to the DB.
function resolveAsset(node) {
  if (node._buttonIconFile) node._buttonIconUrl = node._buttonIconFile;
  if (!node.asset) return node;
  const match = assetManifest.find((a) => a.nodeId === node.asset.nodeId);
  if (match) {
    node._resolvedAssetUrl = match.file; // local path, resolved to attachment in stage 4
  } else {
    console.warn(`No asset manifest entry for node ${node.id} (figma node ${node.asset.nodeId})`);
  }
  return node;
}

// Gate: never compile input that violates schema/normalized-schema.json.
const gate = validateNormalized(normalized, assetManifest.length ? assetManifest : null);
if (gate.errors.length) {
  console.error(`normalized.json failed validation (${gate.errors.length} error(s)) — not compiling:`);
  for (const e of gate.errors) console.error("  -", e);
  process.exit(1);
}

const flatElements = [];
const warnings = [...gate.warnings]; // QA notes + unsupported elements from the normalized layer

function compileNode(node, parentId) {
  // "page" is a normalized-schema convenience root, not a real Bricks
  // element — pass its children straight through without emitting anything
  // for "page" itself. (Needed because our fixture/roadmap examples wrap
  // everything in {"type":"page","children":[...]} and there's no such
  // element in real Bricks exports.)
  if (node.type === "page") {
    const childIds = [];
    for (const child of node.children || []) {
      const childId = compileNode(child, parentId || 0);
      if (childId) childIds.push(childId);
    }
    return null; // nothing to report upward — caller (root call) ignores this
  }

  if (node.type === "unsupported") return; // already reported by the normalized validator
  const template = ELEMENT_TEMPLATES[node.type];
  if (!template) {
    warnings.push(`No Bricks template for normalized type "${node.type}" (id: ${node.id}) — skipped.`);
    return;
  }

  resolveAsset(node);
  if (node._bgImage) resolveAsset(node._bgImage);

  const el = template(node);
  const bricksId = makeId();
  if (el.settings?._cssCustom) el.settings._cssCustom = el.settings._cssCustom.replaceAll("__ID__", bricksId);

  const childIds = [];
  for (const child of node.children || []) {
    const childId = compileNode(child, bricksId);
    if (childId) childIds.push(childId);
  }

  const compiled = {
    id: bricksId,
    name: el.name,
    parent: parentId || 0,
    children: childIds,
    settings: stripUndefined(el.settings),
  };
  // Carry themeStyles through when the template provides it — confirmed
  // real Bricks image/icon elements include "themeStyles": [] (see
  // schema/bricks-elements.json sampleValues). Omit entirely rather than
  // guess for element types that don't specify it.
  if (el.themeStyles !== undefined) compiled.themeStyles = el.themeStyles;

  flatElements.push(compiled);

  return bricksId;
}

function stripUndefined(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = typeof v === "object" && !Array.isArray(v) ? stripUndefined(v) : v;
  }
  return out;
}

// Responsive pass (deterministic): container wrapper, fluid widths, breakpoints, button icon. Skip with --no-responsive.
let toCompile = normalized;
if (!process.argv.includes("--no-responsive")) {
  let fontAliases = {};
  if (fs.existsSync("font-aliases.json")) fontAliases = JSON.parse(fs.readFileSync("font-aliases.json", "utf-8"));
  // Figma geometry (id -> bounding box) from the full-frame extract, found next to or two levels above a section folder.
  const geo = {};
  const texts = {}; // figma text node id -> { textCase, characters }: lets old normalized files pick up the text case without a model run
  for (const dir of [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")]) {
    const fp = path.join(dir, "figma-node.json");
    if (!fs.existsSync(fp)) continue;
    (function walk(n) { if (n?.id && n.absoluteBoundingBox) geo[n.id] = n.absoluteBoundingBox; if (n?.type === "TEXT") texts[n.id] = { textCase: n.style?.textCase, characters: n.characters }; for (const c of n?.children || []) walk(c); })(JSON.parse(fs.readFileSync(fp, "utf-8")));
    break;
  }
  const rp = responsify(normalized, { manifest: assetManifest, fontAliases, geo, texts });
  toCompile = rp.doc;
  for (const line of rp.report) console.log("  responsive:", line);
}
compileNode(toCompile, 0);

const outPath = path.join(frameDir, "bricks-tree.json");
fs.writeFileSync(outPath, JSON.stringify(flatElements, null, 2));
console.log(`Wrote ${outPath} (${flatElements.length} element(s))`);

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const w of warnings) console.warn(" - " + w);
}