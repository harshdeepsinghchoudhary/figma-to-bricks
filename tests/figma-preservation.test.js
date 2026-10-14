import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { preserveFigma, reconcileFigmaProperties, deterministicNormalize, collectImageFillSources, backupExtraction } from "../scripts/figma-preservation.js";
import { applyFigmaSettings } from "../scripts/figma-settings.js";
import { validateNormalized } from "../scripts/normalized-validator.js";
import { isGraphicNode } from "../scripts/graphic-detect.js";

const box = (x, y, width, height) => ({ x, y, width, height });
const paint = (r, g, b) => ({ type: "SOLID", color: { r, g, b } });
function fixture() {
  return {
    id: "10:1", name: "Account form", type: "FRAME", absoluteBoundingBox: box(-300, 80, 600, 400), layoutMode: "VERTICAL", layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", itemSpacing: 0,
    primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "STRETCH", paddingTop: 12, paddingRight: 18, paddingBottom: 24, paddingLeft: 18,
    clipsContent: true, rectangleCornerRadii: [8, 12, 16, 20], fills: [paint(1, 1, 1)], componentProperties: { Mode: { type: "VARIANT", value: "Expanded" } },
    children: [
      { id: "10:2", name: "Title", type: "TEXT", characters: "Keep\u00a0spacing\u2028exact", absoluteBoundingBox: box(-282, 92, 400, 36), layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", minWidth: 100, maxWidth: 500, style: { fontFamily: "Inter", fontSize: 24, fontWeight: 600, lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: 135, letterSpacing: 0 }, fills: [paint(0, 0, 0)], characterStyleOverrides: [0, 1], styleOverrideTable: { 1: { fontWeight: 700 } } },
      { id: "10:3", name: "Hidden alternative", type: "FRAME", visible: false, absoluteBoundingBox: box(4000, 5000, 800, 400), children: [{ id: "10:4", name: "Hidden text", type: "TEXT", characters: "Hidden" }] },
      { id: "10:5", name: "Badge", type: "RECTANGLE", absoluteBoundingBox: box(190, 90, 80, 40), layoutPositioning: "ABSOLUTE", opacity: 0.4, constraints: { horizontal: "MAX", vertical: "MIN" }, minHeight: 20, maxHeight: 60, fills: [paint(1, 0.5, 0)], effects: [{ type: "DROP_SHADOW", visible: true, color: { r: 0, g: 0, b: 0, a: 0.3 }, radius: 4, offset: { x: 2, y: 3 }, spread: 1 }] }
    ]
  };
}

test("preserved index records exact hierarchy and source properties including hidden descendants", () => {
  const raw = fixture();
  raw.futureLayoutProperty = { alignment: "baseline" };
  raw.fillGeometry = [{ path: "M0 0 L1 1", windingRule: "NONZERO" }];
  const before = JSON.stringify(raw);
  const first = preserveFigma(raw, { styles: { body: { key: "body" } } });
  assert.equal(first.rootId, raw.id);
  assert.deepEqual(first.nodes[raw.id].childIds, ["10:2", "10:3", "10:5"]);
  assert.equal(first.nodes["10:2"].parentId, raw.id);
  assert.equal(first.nodes["10:4"].effectiveVisible, false);
  assert.deepEqual(first.nodes["10:2"].styleOverrideTable, raw.children[0].styleOverrideTable);
  assert.deepEqual(first.nodes["10:5"].constraints, raw.children[2].constraints);
  assert.deepEqual(first.metadata.styles, { body: { key: "body" } });
  assert.deepEqual(first.nodes[raw.id].extraSourceProperties.futureLayoutProperty, raw.futureLayoutProperty);
  assert.deepEqual(first.nodes[raw.id].rawGeometryFields, ["fillGeometry"]);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(preserveFigma(raw), preserveFigma(raw));
});

test("raw Auto Layout, exact copy, sizing, radius and shadows override model guesses", () => {
  const raw = fixture();
  const doc = { type: "page", children: [{ type: "section", id: "account", figmaNodeId: raw.id, layout: { gap: 100, direction: "row", padding: { top: 999 } }, children: [{ type: "heading", id: "title", figmaNodeId: "10:2", text: "wrong", typography: { lineHeight: "135px" } }, { type: "block", id: "badge", figmaNodeId: "10:5" }] }] };
  const { report } = reconcileFigmaProperties(doc, raw);
  const root = doc.children[0];
  assert.equal(root.layout.direction, "column");
  assert.equal(root.layout.gap, 0);
  assert.deepEqual(root.layout.padding, { top: 12, right: 18, bottom: 24, left: 18 });
  assert.equal(root.layout.align, "stretch");
  assert.deepEqual(root.border.radii, { topLeft: 8, topRight: 12, bottomRight: 16, bottomLeft: 20 });
  assert.equal(root.children[0].text, raw.children[0].characters);
  assert.equal(root.children[0].typography.lineHeight, "135%");
  assert.equal(root.children[0].typography.letterSpacing, "0px");
  assert.equal(root.children[0].size.width, "fill");
  assert.equal(root.children[0].size.height, "hug");
  assert.deepEqual(root.children[1].figma.position, { mode: "absolute", left: 490, top: 10 });
  assert.equal(root.children[1].boxShadow.color, "#0000004D");
  assert.equal(report.summary.hidden, 2);
  assert.equal(validateNormalized(doc).errors.length, 0);
});

test("deterministic overlap keeps z-order and measured offsets without losing source nodes", () => {
  const root = { id: "overlap:1", type: "FRAME", name: "Art card", absoluteBoundingBox: box(100, 200, 400, 200), children: [{ id: "overlap:2", name: "Offset panel", type: "RECTANGLE", absoluteBoundingBox: box(100, 200, 350, 200), fills: [paint(0, 0, 1)] }, { id: "overlap:3", name: "Text overlay", type: "TEXT", characters: "Overlay", absoluteBoundingBox: box(120, 215, 100, 30), style: { fontSize: 20 } }] };
  const first = deterministicNormalize(root);
  const second = deterministicNormalize(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.doc.children[0].children.map((node) => node.figmaNodeId), ["overlap:2", "overlap:3"]);
  assert.deepEqual(first.doc.children[0].children[1].figma.position, { mode: "absolute", left: 20, top: 15 });
  assert.equal(first.report.summary.unrepresented, 0);
  assert.equal(validateNormalized(first.doc).errors.length, 0);
});

test("full-size background is accounted for as native paint and single-child padding is measured", () => {
  const root = { id: "panel:1", type: "FRAME", name: "Panel", absoluteBoundingBox: box(100, 200, 400, 200), children: [{ id: "panel:2", type: "RECTANGLE", absoluteBoundingBox: box(100, 200, 400, 200), fills: [paint(0, 0, 1)], cornerRadius: 12 }, { id: "panel:3", type: "TEXT", characters: "Panel title", absoluteBoundingBox: box(120, 215, 100, 30) }] };
  const result = deterministicNormalize(root);
  const panel = result.doc.children[0];
  assert.equal(panel.children.length, 1);
  assert.equal(panel.background.color, "#0000FF");
  assert.equal(panel.border.radius, 12);
  assert.deepEqual(panel.layout.padding, { top: 15, right: 280, bottom: 155, left: 20 });
  assert.equal(result.report.nodes.find((node) => node.nodeId === "panel:2").status, "absorbed-paint");
  assert.equal(result.report.summary.unrepresented, 0);
  assert.equal(validateNormalized(result.doc).errors.length, 0);
});

test("measured setting application respects installed control support and original parent origin", () => {
  const { doc } = deterministicNormalize(fixture());
  const root = doc.children[0];
  const badge = root.children.find((node) => node.figmaNodeId === "10:5");
  const keys = new Set(["_overflow", "_position", "_left", "_top", "_width", "_height", "_opacity", "_heightMin", "_heightMax", "_border"]);
  const settings = {};
  assert.equal(applyFigmaSettings(badge, settings, { supportedKeys: keys, parentNode: root }).length, 0);
  assert.equal(settings._position, "absolute");
  assert.equal(settings._left, "490px");
  assert.equal(settings._opacity, "0.4");
  assert.equal(settings._heightMax, "60px");
  const wrong = {};
  const warnings = applyFigmaSettings(badge, wrong, { supportedKeys: keys, parentNode: { id: "new-wrapper" } });
  assert.equal(wrong._left, undefined);
  assert.ok(warnings.some((warning) => warning.includes("offset belongs")));
  const unsupported = {};
  assert.ok(applyFigmaSettings(root, unsupported).length > 0);
  assert.deepEqual(unsupported, {});
});

test("large vectors and hairline strokes remain exportable, missing graphics fail explicitly", () => {
  const curve = { id: "svg:1", type: "VECTOR", name: "Long wave", absoluteBoundingBox: box(0, 0, 4000, 50), fills: [paint(1, 0, 0)] };
  const line = { id: "svg:2", type: "LINE", name: "Hairline", absoluteBoundingBox: box(0, 0, 100, 0), strokeWeight: 1, strokes: [paint(0, 0, 0)] };
  assert.equal(isGraphicNode(curve).isGraphic, true);
  assert.equal(isGraphicNode(line).isGraphic, true);
  const nativeLine = deterministicNormalize({ id: "line:root", type: "FRAME", children: [line] }).doc.children[0].children[0];
  assert.equal(nativeLine.type, "spacer");
  assert.deepEqual(nativeLine.border.sides, ["top"]);
  assert.equal(nativeLine.size.height, 0);
  assert.equal(validateNormalized({ type: "page", children: [nativeLine] }).errors.length, 0);
  assert.throws(() => deterministicNormalize({ id: "svg:root", type: "FRAME", children: [curve] }), /Required export missing/);
  const result = deterministicNormalize({ id: "svg:root", type: "FRAME", children: [curve] }, [{ nodeId: curve.id, type: "svg", file: "wave.svg" }]);
  assert.equal(result.doc.children[0].children[0].asset.kind, "svg");
});

test("source image backgrounds keep child text editable and avoid opacity twice", () => {
  const root = { id: "photo:1", type: "FRAME", name: "Photo card", absoluteBoundingBox: box(0, 0, 500, 200), opacity: 0.7, fills: [{ type: "IMAGE", imageRef: "source-ref", scaleMode: "FIT" }], children: [{ id: "photo:2", type: "TEXT", characters: "Editable title", absoluteBoundingBox: box(20, 20, 200, 30) }] };
  const fills = collectImageFillSources(root);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].nodeId, "photo:1:image-fill");
  const { doc } = deterministicNormalize(root, [{ ...fills[0], file: "raw.png" }]);
  assert.equal(doc.children[0].children[0].text, "Editable title");
  const settings = {};
  const requests = [];
  const warnings = applyFigmaSettings(doc.children[0], settings, { supportedKeys: new Set(["_opacity", "_background"]), assetUrl: (id) => { requests.push(id); return "assets/raw.png"; } });
  assert.deepEqual(requests, ["photo:1:image-fill"]);
  assert.equal(settings._background.size, "contain");
  assert.equal(settings._opacity, "0.7");
  assert.deepEqual(warnings, []);
  const image = { id: "photo-export", type: "image", figma: { opacity: 0.7 } };
  const imageSettings = {};
  applyFigmaSettings(image, imageSettings, { supportedKeys: new Set(["_opacity"]) });
  assert.equal(imageSettings._opacity, undefined);
});

test("refresh backup preserves existing extraction and asset bytes", () => {
  const work = path.resolve(".preservation-backup-test-work");
  assert.equal(path.dirname(work), path.resolve("."));
  fs.mkdirSync(path.join(work, "assets"), { recursive: true });
  try {
    fs.writeFileSync(path.join(work, "figma-node.json"), "original source");
    fs.writeFileSync(path.join(work, "assets", "old.svg"), "original asset");
    const backup = backupExtraction(work);
    assert.ok(path.relative(work, backup).startsWith("extract-backups"));
    fs.writeFileSync(path.join(work, "figma-node.json"), "new source");
    fs.writeFileSync(path.join(work, "assets", "old.svg"), "new asset");
    assert.equal(fs.readFileSync(path.join(backup, "figma-node.json"), "utf8"), "original source");
    assert.equal(fs.readFileSync(path.join(backup, "assets", "old.svg"), "utf8"), "original asset");
  } finally {
    if (path.dirname(work) !== path.resolve(".")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("stage 2 deterministic CLI works without screenshot or a configured AI chain", () => {
  const work = path.resolve(".preservation-test-work");
  assert.equal(path.dirname(work), path.resolve("."));
  fs.mkdirSync(work, { recursive: true });
  try {
    fs.writeFileSync(path.join(work, "figma-node.json"), JSON.stringify(fixture()));
    fs.writeFileSync(path.join(work, "asset-manifest.json"), "[]");
    const result = spawnSync(process.execPath, ["scripts/2_normalize.js", work, "--deterministic"], { encoding: "utf8", env: { ...process.env, AI_PROVIDER: "auto", AI_PROVIDER_CHAIN: "unknown" } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const normalized = JSON.parse(fs.readFileSync(path.join(work, "normalized.json"), "utf8"));
    assert.equal(validateNormalized(normalized, []).errors.length, 0);
    assert.equal(normalized.children[0].layout.gap, 0);
    assert.ok(fs.existsSync(path.join(work, "figma-preserved.json")));
    assert.ok(fs.existsSync(path.join(work, "figma-coverage.json")));
    assert.match(result.stdout, /no AI provider or screenshot used/);
  } finally {
    if (path.dirname(work) !== path.resolve(".")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(work, { recursive: true, force: true });
  }
});
