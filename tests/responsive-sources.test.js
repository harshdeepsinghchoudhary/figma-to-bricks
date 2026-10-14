import test from "node:test";
import assert from "node:assert/strict";
import { breakpointConfig } from "../scripts/breakpoints.js";
import { applyResponsiveSources } from "../scripts/responsive-sources.js";
import { hasLayoutBoundary } from "../scripts/layout-boundaries.js";
import { structurePass } from "../scripts/structure-pass.js";

test("responsive generation uses installed custom breakpoint keys and widths", () => {
  const config = breakpointConfig({ breakpoints: { baseKey: "base", breakpoints: [{ key: "base", width: 1280, base: true }, { key: "medium", width: 1000 }, { key: "small", width: 640 }] } });
  assert.deepEqual(config.keys, ["medium", "small"]);
  assert.equal(config.tablet, "medium"); assert.equal(config.mobile, "small");
});
test("wrapper simplification preserves clipping, transforms and native component boundaries", () => {
  for (const figma of [{ clipsContent: true }, { opacity: 0.5 }, { relativeTransform: [[0, -1, 0], [1, 0, 0]] }]) {
    const wrapper = { id: "masked", type: "column", figma, layout: { direction: "column" }, children: [{ type: "text", id: "copy", text: "Editable" }] };
    const doc = { type: "page", children: [{ id: "section", type: "section", children: [wrapper] }] };
    assert.ok(hasLayoutBoundary(wrapper));
    assert.equal(structurePass(doc).doc.children[0].children[0].id, "masked");
  }
  assert.equal(hasLayoutBoundary({ figma: { relativeTransform: [[1, 0, 30], [0, 1, 20]] } }), false);
});
test("explicit responsive Figma measurements replace inferred layout without screenshots", () => {
  const doc = { type: "page", children: [{ type: "column", id: "content", figmaNodeId: "desktop", children: [], responsive: { small: { layout: { gap: 40, direction: "row" } } } }] };
  const source = { id: "mobile", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 12, paddingLeft: 16, layoutSizingHorizontal: "FILL", absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 200 }, children: [] };
  const result = applyResponsiveSources(doc, { small: { source: "mobile.json", nodes: { desktop: "mobile" } } }, { breakpointKeys: ["small"], load: () => source });
  assert.equal(result.doc.children[0].responsive.small.layout.gap, 12);
  assert.equal(result.doc.children[0].responsive.small.layout.direction, "column");
  assert.equal(result.doc.children[0].responsive.small.size.width, "fill");
  assert.equal(doc.children[0].responsive.small.layout.gap, 40);
  assert.throws(() => applyResponsiveSources(doc, { unknown: {} }, { breakpointKeys: ["small"] }), /unconfigured/);
});
