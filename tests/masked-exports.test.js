import test from "node:test";
import assert from "node:assert/strict";
import { isGraphicNode } from "../scripts/graphic-detect.js";
import { deterministicNormalize } from "../scripts/figma-preservation.js";

const bounds = { x: -2812, y: 7811, width: 364, height: 340 };
const mask = () => ({
  id: "202:209", name: "Ellipse 1", type: "VECTOR", isMask: true,
  maskType: "ALPHA", absoluteBoundingBox: { ...bounds }, absoluteRenderBounds: null,
  fills: [{ type: "SOLID", color: { r: 0.2, g: 0.06, b: 0.1, a: 1 } }],
  fillGeometry: [{ path: "M364 186C364 297 288 340 178 340C68 340 0 297 0 186C0 76 75 0 185 0C295 0 364 76 364 186Z", windingRule: "NONZERO" }]
});
const photo = () => ({
  id: "202:210", name: "image 32", type: "RECTANGLE",
  absoluteBoundingBox: { ...bounds, x: -3021, width: 647 },
  absoluteRenderBounds: { ...bounds },
  fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "original-photo" }]
});
const maskGroup = () => ({
  id: "202:208", name: "Mask group", type: "GROUP",
  absoluteBoundingBox: { ...bounds }, absoluteRenderBounds: { ...bounds },
  children: [mask(), photo()]
});
const page = (group) => ({
  id: "202:12", name: "Masked photo page", type: "FRAME",
  absoluteBoundingBox: { ...bounds, width: 1120, height: 540 }, children: [group]
});

test("clipping masks are not standalone renderable graphic assets", () => {
  assert.equal(isGraphicNode(mask()).isGraphic, false);
  const visibleVector = { ...mask(), id: "visible-vector", isMask: false, absoluteRenderBounds: { ...bounds } };
  assert.equal(isGraphicNode(visibleVector).isGraphic, true);
});

test("masked photo composition exports the parent as PNG instead of the clipping vector", () => {
  const graphic = isGraphicNode(maskGroup());
  assert.equal(graphic.isGraphic, true);
  assert.equal(graphic.masked, true);
  assert.equal(graphic.format, "png");
  // An ordinary photograph remains an image-fill asset; it does not become a vector graphic.
  assert.equal(isGraphicNode(photo()).isGraphic, false);
});

test("mask groups containing editable text stay outside the flattened graphic export", () => {
  const group = maskGroup();
  group.children.push({
    id: "202:211", name: "Photo caption", type: "TEXT", characters: "Editable caption",
    absoluteBoundingBox: { ...bounds, width: 200, height: 24 }
  });
  assert.equal(isGraphicNode(group).isGraphic, false);
});

test("normalization keeps the complete mask composition as one image and accounts for its source children", () => {
  const group = maskGroup();
  const asset = { nodeId: group.id, name: group.name, type: "image", file: "assets/mask-group-202_208.png" };
  const { doc, preserved, report } = deterministicNormalize(page(group), [asset]);
  const image = doc.children[0].children[0];
  assert.equal(image.type, "image");
  assert.deepEqual(image.asset, { nodeId: group.id, kind: "image" });
  assert.equal(image.children, undefined);
  assert.equal(image.size.width, 364);
  assert.equal(image.size.height, 340);
  assert.equal(preserved.nodes["202:209"].isMask, true);
  assert.equal(preserved.nodes["202:210"].absoluteBoundingBox.width, 647);
  for (const id of ["202:209", "202:210"]) {
    const coverage = report.nodes.find((node) => node.nodeId === id);
    assert.equal(coverage.status, "covered-by-export");
    assert.equal(coverage.representedBy, group.id);
  }
});

test("normalization refuses to silently omit a missing complete mask composition export", () => {
  assert.throws(() => deterministicNormalize(page(maskGroup()), []), /Required export missing for 202:208/);
});
