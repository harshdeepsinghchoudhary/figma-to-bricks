import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nativeFixture } from "./fixtures/native-components.js";
import { recognizeComponents, validateNativeComponents, protectNativeStructures } from "../scripts/native-components.js";
import { validateBricks } from "../scripts/bricks-validator.js";
import { responsify } from "../scripts/responsive-pass.js";

const all = node => [node, ...(node.children || []).flatMap(all)];
const by = (doc, id) => all(doc).find(node => node.id === id);
const workRoot = path.resolve(".test-work"); fs.mkdirSync(workRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(workRoot, "native-"));
const write = (dir, name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));

test("native recognition retains editable content and does not turn ordinary cards into sliders", () => {
  const original = nativeFixture(), result = recognizeComponents(original);
  assert.deepEqual(result.decisions.filter(d => d.status === "native").map(d => d.kind).sort(), ["accordion", "form", "navigation", "slider", "tabs"]);
  assert.equal(by(result.doc, "feature-cards")._nativeName, undefined);
  assert.equal(by(result.doc, "details-tabs")._nativeName, "tabs-nested");
  assert.equal(JSON.parse(by(result.doc, "featured-carousel")._nativeSettings.options).breakpoints[478].perPage, 1);
  assert.equal(by(result.doc, "featured-carousel")._nativeSettings["perPage:mobile_portrait"], undefined);
  for (const node of all(original).filter(n => n.text && n.id !== "catalog-title")) assert.equal(by(result.doc, node.id)?.text, node.text);
  assert.equal(by(result.doc, "catalog-dropdown")._nativeSettings.text, "Catalog");
  assert.deepEqual(original, nativeFixture(), "input is immutable");
});

test("ambiguous tabs, form fields, and card rows retain their original trees", () => {
  for (const kind of ["tabs", "accordion", "form"]) {
    const doc = { type: "page", children: [{ type: "block", id: `ambiguous-${kind}`, component: { kind }, children: [{ type: "text-basic", id: "sample-text", text: "Only a title" }] }] };
    const result = recognizeComponents(doc); assert.deepEqual(result.doc, doc); assert.equal(result.decisions[0].status, "deferred");
  }
  const missing = path.join(work, "missing-schemas"); fs.mkdirSync(missing);
  assert.deepEqual(recognizeComponents(nativeFixture(), { schemaDir: missing }).doc, nativeFixture());
});

test("native responsive wrappers resist generic card grid and stack transformations", () => {
  const doc = recognizeComponents(nativeFixture()).doc, responsive = responsify(doc).doc;
  const slider = by(responsive, "featured-carousel"), nav = by(responsive, "main-navigation");
  assert.equal(slider.layout.display, "flex"); assert.equal(slider.responsive?.tablet_portrait?.layout?.gridColumns, undefined);
  assert.equal(nav.responsive?.tablet_portrait?.layout?.direction, undefined);
  const restored = protectNativeStructures(doc, masked => { const native = by(masked, "featured-carousel"); assert.equal(native.type, "block"); assert.ok(native.children.length); assert.ok(native.notes.includes("Native component boundary")); return { doc: masked, report: [] }; });
  assert.deepEqual(by(restored.doc, "featured-carousel"), slider);
  assert.throws(() => protectNativeStructures(doc, masked => ({ doc: { ...masked, children: [] } })), /discarded native/);
});

test("compiler emits schema-valid native hierarchy, controls, and deterministic IDs", () => {
  write(work, "normalized.json", nativeFixture()); write(work, "asset-manifest.json", []);
  const result = spawnSync(process.execPath, ["scripts/3_compile_bricks.js", work], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const serialized = fs.readFileSync(path.join(work, "bricks-tree.json"), "utf8"), tree = JSON.parse(serialized), validation = validateBricks(tree, { strict: true });
  assert.deepEqual(validation.errors, []); assert.deepEqual(validation.warnings, []);
  assert.deepEqual(validateNativeComponents(tree).errors, []);
  for (const name of ["nav-nested", "dropdown", "toggle", "slider-nested", "tabs-nested", "accordion-nested", "form"]) assert.ok(tree.some(el => el.name === name), `missing ${name}`);
  const form = tree.find(el => el.name === "form"); assert.equal(form.settings.fields.length, 3); assert.deepEqual(form.settings.actions, []);
  assert.match(validateNativeComponents(tree).warnings.join("\n"), /submission actions/);
  const nav = tree.find(el => el.name === "nav-nested"); assert.equal(nav.settings.mobileMenu, "mobile_landscape");
  const menu = tree.find(el => el.settings?._hidden?._cssClasses === "brx-nav-nested-items"); assert.equal(menu.parent, nav.id); assert.equal(menu.deletable, false);
  const broken = structuredClone(tree); broken.find(el => el.id === menu.id).settings.tag = "div"; assert.match(validateNativeComponents(broken).errors.join("\n"), /ul mobile/);
  const repeat = spawnSync(process.execPath, ["scripts/3_compile_bricks.js", work], { encoding: "utf8" }); assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr); assert.equal(fs.readFileSync(path.join(work, "bricks-tree.json"), "utf8"), serialized);
});

test("navigation never fabricates missing targets and image slides keep their media node", () => {
  const doc = { type: "page", children: [{ type: "row", id: "header-menu", children: ["Shop", "About", "Contact"].map((text, i) => ({ type: "text-basic", id: `link-${i}`, text })) }, { type: "block", id: "photo-carousel", component: { kind: "slider" }, children: [1, 2].map(i => ({ type: "image", id: `photo-${i}`, asset: { kind: "image", nodeId: `2:${i}` } })) }] };
  const result = recognizeComponents(doc); assert.equal(by(result.doc, "header-menu")._nativeName, "nav-nested"); assert.equal(by(result.doc, "link-0")._nativeSettings.link, undefined); assert.match(result.report.join("\n"), /destination absent/);
  assert.equal(by(result.doc, "photo-1").type, "image"); assert.equal(by(result.doc, "photo-1-slide")._nativeName, "block");
});

test("measured wide menus select a supported native switch threshold and respect explicit breakpoints", () => {
  const make = explicit => ({ type: "page", children: [{ type: "section", id: "header", background: { color: "#F0C000" }, children: [{ type: "row", id: "header-navigation", figmaNodeId: "1:1", component: { kind: "navigation", options: { ...(explicit ? { mobileBreakpoint: "mobile_landscape" } : {}) } }, size: { width: 1400 }, layout: { direction: "row", gap: 70 }, children: [0, 1, 2].map(index => ({ type: "text-basic", id: `wide-link-${index}`, figmaNodeId: `2:${index}`, text: `Destination ${index}` })) }] }] });
  const figmaRoot = { id: "1:1", type: "FRAME", name: "Navigation", children: [0, 1, 2].map(index => ({ id: `2:${index}`, type: "TEXT", absoluteBoundingBox: { x: index * 470, y: 0, width: 400, height: 30 } })) };
  const inferred = by(recognizeComponents(make(false), { figmaRoot }).doc, "header-navigation");
  assert.equal(inferred._nativeSettings.mobileMenu, "custom"); assert.equal(inferred._nativeSettings.mobileMenuCustomBreakpoint, "1372");
  assert.deepEqual(inferred._nativeSettings.mobileMenuBackgroundColor, { raw: "#F0C000" }); assert.equal(inferred.size.width, undefined);
  const explicit = by(recognizeComponents(make(true), { figmaRoot }).doc, "header-navigation"); assert.equal(explicit._nativeSettings.mobileMenu, "mobile_landscape"); assert.equal(explicit._nativeSettings.mobileMenuCustomBreakpoint, undefined);
});

test("unnamed shallow header bands recognize navigation without classifying body card rows", () => {
  function fixture({ body = false, home = true } = {}) {
    const page = { id: "0:1", type: "FRAME", name: "Desktop", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 2400 }, children: [] };
    const group = { id: "1:1", type: "GROUP", name: "Group 1", absoluteBoundingBox: { x: 0, y: body ? 134 : 60, width: 1440, height: body ? 360 : 60 }, children: [] };
    const row = { id: "1:2", type: "FRAME", name: "Frame 1", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 40, y: body ? 180 : 76, width: 680, height: 32 }, children: [] };
    const labels = [home ? "Home" : "Overview", "Products", "Contact"];
    row.children = labels.map((label, index) => ({ id: `2:${index}`, type: "TEXT", name: label, characters: label, absoluteBoundingBox: { x: 40 + index * 220, y: body ? 184 : 80, width: 90, height: 24 } }));
    group.children = [{ id: "1:3", type: "RECTANGLE", name: "Rectangle 1", absoluteBoundingBox: { ...group.absoluteBoundingBox }, fills: [{ type: "SOLID", color: { r: 1, g: 0.8, b: 0 } }] }, row]; page.children = [group];
    const first = { type: "row", id: "frame-a", figmaNodeId: "2:0", background: { color: "#22222222" }, layout: { padding: { top: 4, right: 8, bottom: 4, left: 8 } }, children: [{ type: "text", id: "first-label", text: labels[0], typography: { fontSize: 16 } }] };
    const doc = { type: "page", children: [{ type: "section", id: "scope", children: [{ type: "column", id: "group-a", figmaNodeId: "1:1", children: [{ type: "row", id: "frame-b", figmaNodeId: "1:2", layout: { direction: "row", gap: 30 }, children: [first, ...labels.slice(1).map((text, index) => ({ type: "text", id: `label-${index + 1}`, figmaNodeId: `2:${index + 1}`, text, typography: { fontSize: 16 } }))] }] }] }] };
    return { doc, figmaRoot: page };
  }
  const header = fixture(), native = recognizeComponents(header.doc, { figmaRoot: header.figmaRoot });
  assert.equal(by(native.doc, "frame-b")._nativeName, "nav-nested");
  assert.equal(by(native.doc, "frame-a")._nativeSettings.text, "Home"); assert.deepEqual(by(native.doc, "frame-a").layout.padding, { top: 4, right: 8, bottom: 4, left: 8 }); assert.equal(by(native.doc, "frame-a").typography.fontSize, 16);
  assert.deepEqual(by(native.doc, "frame-b")._nativeSettings.mobileMenuBackgroundColor, { raw: "#FFCC00" });
  const body = fixture({ body: true }), unchanged = recognizeComponents(body.doc, { figmaRoot: body.figmaRoot }); assert.equal(by(unchanged.doc, "frame-b")._nativeName, undefined); assert.deepEqual(unchanged.doc, body.doc);
  const ambiguous = fixture({ home: false }), potential = recognizeComponents(ambiguous.doc, { figmaRoot: ambiguous.figmaRoot }); assert.equal(by(potential.doc, "frame-b")._nativeName, undefined); assert.equal(potential.decisions.find(d => d.id === "frame-b").status, "potential");
});

test.after(() => { if (!work.startsWith(workRoot + path.sep)) throw new Error("Unsafe native fixture cleanup"); fs.rmSync(work, { recursive: true, force: true }); });