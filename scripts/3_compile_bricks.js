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
import { createHash } from "node:crypto";
import { ELEMENT_TEMPLATES, buildBricksElement, escapeText } from "./bricks-schema.js";
import { recognizeComponents, protectNativeStructures, runtimeKeys, validateNativeComponents } from "./native-components.js";
import { applyFigmaSettings } from "./figma-settings.js";
import { validateBricks } from "./bricks-validator.js";
import { applyResponsiveSourceFile } from "./responsive-sources.js";
import { reconcileFigmaProperties } from "./figma-preservation.js";
import { validateNormalized } from "./normalized-validator.js";
import { responsify } from "./responsive-pass.js";
import { structurePass } from "./structure-pass.js";

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
  for (const l of node._pseudo || []) {
    const m = assetManifest.find((a) => a.nodeId === l.asset?.nodeId);
    if (m) l._resolvedAssetUrl = m.file; else warnings.push(`decoration layer ${l.asset?.nodeId} on ${node.id} has no asset - run stage 1 again to export it`);
  }
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
const emittedIds = new Set();
const sourceMap = {};
// Persist the initial seed so IDs (and expensive visual caches) survive moving the project.
const idNamespacePath = path.join(frameDir, "bricks-id-namespace.json");
const idNamespace = fs.existsSync(idNamespacePath) ? JSON.parse(fs.readFileSync(idNamespacePath, "utf8")).namespace : path.resolve(frameDir);
if (typeof idNamespace !== "string" || !idNamespace) throw new Error("Invalid bricks-id-namespace.json");
if (!fs.existsSync(idNamespacePath)) fs.writeFileSync(idNamespacePath, JSON.stringify({ namespace: idNamespace }, null, 2));
const warnings = [...gate.warnings]; // QA notes + unsupported elements from the normalized layer

function compileNode(node, parentId, parentNode = null) {
  // "page" is a normalized-schema convenience root, not a real Bricks
  // element — pass its children straight through without emitting anything
  // for "page" itself. (Needed because our fixture/roadmap examples wrap
  // everything in {"type":"page","children":[...]} and there's no such
  // element in real Bricks exports.)
  if (node.type === "page") {
    const childIds = [];
    for (const child of node.children || []) {
      const childId = compileNode(child, parentId || 0, parentNode);
      if (childId) childIds.push(childId);
    }
    return null; // nothing to report upward — caller (root call) ignores this
  }

  if (node.type === "unsupported") return; // already reported by the normalized validator
  const template = node._nativeName
    ? n => buildBricksElement(n._nativeName, n, { content: { ...n._nativeSettings, ...(n._nativeSettings?.text !== undefined ? { text: escapeText(n._nativeSettings.text) } : {}) } })
    : ELEMENT_TEMPLATES[node.type];
  if (!template) {
    warnings.push(`No Bricks template for normalized type "${node.type}" (id: ${node.id}) — skipped.`);
    return;
  }

  resolveAsset(node);
  if (node._bgImage) resolveAsset(node._bgImage);

  const el = template(node);
  if (node._nativeSettings) Object.assign(el.settings, node._nativeSettings);
  const supportedKeys = runtimeKeys(el.name);
  warnings.push(...applyFigmaSettings(node, el.settings, { supportedKeys, parentNode,
    assetUrl: id => assetManifest.find(a => a.nodeId === id)?.file }));
  if (node._nativeName) {
    for (const key of Object.keys(el.settings)) {
      const sourceKey = key.split(":")[0], targetKey = { _direction: "_flexDirection", _rowGap: "_gap", _columnGap: "_gap" }[sourceKey];
      if (!targetKey || supportedKeys.has(sourceKey) || !supportedKeys.has(targetKey) || el.settings[key] === undefined) continue;
      const target = targetKey + key.slice(sourceKey.length);
      if (el.settings[target] === undefined) el.settings[target] = el.settings[key];
      delete el.settings[key];
    }
    // Shared styles need this native element's runtime controls. Pane visibility
    // is managed by Bricks, rather than the hidden Figma variant's display state.
    for (const key of Object.keys(el.settings)) {
      if (el.settings[key] === undefined) continue;
      if (node._nativeManagedDisplay && /^_display(:|$)/.test(key)) { delete el.settings[key]; continue; }
      if (!supportedKeys.has(key.split(":")[0])) { warnings.push(`${node.id}: ${el.name} does not support ${key}; measured style retained in normalized input.`); delete el.settings[key]; }
    }
  }
  let salt = 0, bricksId;
  do {
    const hash = createHash("sha256").update(`${idNamespace}|${node.id}|${salt++}`).digest("hex");
    bricksId = (parseInt(hash.slice(0, 12), 16) % (36 ** 6)).toString(36).padStart(6, "0");
  } while (emittedIds.has(bricksId));
  emittedIds.add(bricksId);
  sourceMap[bricksId] = { normalizedId: node.id, figmaNodeId: node.figmaNodeId || node.asset?.nodeId || node.id };
  if (node._absorbedSourceIds?.length) sourceMap[bricksId].figmaNodeIds = [...new Set([sourceMap[bricksId].figmaNodeId, ...node._absorbedSourceIds])];
  if (el.settings?._cssCustom) el.settings._cssCustom = el.settings._cssCustom.replaceAll("__ID__", bricksId);

  const childIds = [];
  for (const child of node.children || []) {
    const childId = compileNode(child, bricksId, node);
    if (childId) childIds.push(childId);
  }

  const compiled = {
    id: bricksId,
    name: el.name,
    parent: parentId || 0,
    children: childIds,
    settings: stripUndefined(el.settings),
  };
  if (node._nativeFlags) Object.assign(compiled, node._nativeFlags);
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
let componentReport = { report: [], decisions: [] };
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
  let src = normalized;
  let figmaRoot = null;
  for (const dir of [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")]) {
    const fp = path.join(dir, "figma-node.json");
    if (fs.existsSync(fp)) { figmaRoot = JSON.parse(fs.readFileSync(fp, "utf-8")); break; }
  }
  if (figmaRoot) {
    src = structuredClone(src);
    const measured = reconcileFigmaProperties(src, figmaRoot.document || figmaRoot, { manifest: assetManifest });
    warnings.push(...(measured.report?.warnings || []));
  }
  componentReport = recognizeComponents(src, { figmaRoot });
  src = componentReport.doc;
  for (const line of componentReport.report) console.log("  component:", line);
  if (!process.argv.includes("--no-structure")) {
    // --no-structure=a,b switches single rule groups off (hoist, dividers, rebuild, missingText, decoration, wrappers, grids, spanning, roles, sanity, rules)
    const arg = process.argv.find((a) => a.startsWith("--no-structure="));
    const enable = Object.fromEntries((arg ? arg.slice("--no-structure=".length).split(",") : []).filter(Boolean).map((k) => [k, false]));
    const sp = protectNativeStructures(src, masked => structurePass(masked, { figmaRoot: figmaRoot?.document || figmaRoot, manifest: assetManifest, enable }));
    src = sp.doc;
    for (const line of sp.report) console.log("  structure:", line);
  }
  // site (container) width = the most common width of the page's top-level frames that are narrower than the page itself (1320 in a 1440 page)
  let siteWidth = 0;
  for (const dir of [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")]) {
    const fp = path.join(dir, "figma-node.json");
    if (!fs.existsSync(fp)) continue;
    const root = JSON.parse(fs.readFileSync(fp, "utf-8")); const r = root.document || root;
    const pw = r.absoluteBoundingBox?.width || 0, counts = {};
    for (const k of r.children || []) { const w = Math.round(k.absoluteBoundingBox?.width || 0); if (w >= 600 && (!pw || w < pw * 0.99)) counts[w] = (counts[w] || 0) + 1; }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (best) siteWidth = Number(best[0]);
    break;
  }
  const rp = responsify(src, { manifest: assetManifest, fontAliases, geo, texts, siteWidth });
  toCompile = rp.doc;
  for (const line of rp.report) console.log("  responsive:", line);
}
else {
  let figmaRoot = null;
  for (const dir of [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")]) {
    const fp = path.join(dir, "figma-node.json"); if (fs.existsSync(fp)) { figmaRoot = JSON.parse(fs.readFileSync(fp, "utf8")); break; }
  }
  let src = structuredClone(normalized);
  if (figmaRoot) { const measured = reconcileFigmaProperties(src, figmaRoot.document || figmaRoot, { manifest: assetManifest }); warnings.push(...(measured.report?.warnings || [])); }
  componentReport = recognizeComponents(src, { figmaRoot }); toCompile = componentReport.doc;
  for (const line of componentReport.report) console.log("  component:", line);
}
const responsiveSources = applyResponsiveSourceFile(toCompile, frameDir);
toCompile = responsiveSources.doc;
for (const line of responsiveSources.report) console.log("  responsive source:", line);
compileNode(toCompile, 0);

const validation = validateBricks(flatElements, { strict: true });
const nativeValidation = validation.errors.length ? { errors: [], warnings: [] } : validateNativeComponents(flatElements);
const compileErrors = [...validation.errors, ...nativeValidation.errors];
warnings.push(...validation.warnings, ...nativeValidation.warnings);
const compileReport = { status: compileErrors.length ? "failed" : "compiled", elementCount: flatElements.length, components: componentReport.decisions, errors: compileErrors, warnings, frontendBehaviorVerified: false };
fs.writeFileSync(path.join(frameDir, "compile-report.json"), JSON.stringify(compileReport, null, 2));
if (compileErrors.length) { for (const error of compileErrors) console.error(" -", error); console.error("Compiled tree failed nonvisual validation; existing output was preserved."); process.exit(1); }

const outPath = path.join(frameDir, "bricks-tree.json");
fs.writeFileSync(outPath, JSON.stringify(flatElements, null, 2));
fs.writeFileSync(path.join(frameDir, "bricks-source-map.json"), JSON.stringify(sourceMap, null, 2));
console.log(`Wrote ${outPath} (${flatElements.length} element(s))`);

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const w of warnings) console.warn(" - " + w);
}
