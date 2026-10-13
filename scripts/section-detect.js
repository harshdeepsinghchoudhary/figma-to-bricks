const shapeTypes = new Set(["RECTANGLE", "ELLIPSE", "LINE", "VECTOR", "STAR", "REGULAR_POLYGON", "BOOLEAN_OPERATION"]);
const hasContent = (n) => n.visible !== false && (n.type === "TEXT" || n.fills?.some((p) => p.visible !== false && p.type === "IMAGE") || (n.children || []).some(hasContent));

// A primitive entirely inside a content-bearing sibling belongs to its visual area,
// not to an additional page section. Keep the primitive in the Figma source tree.
export function decorationOwner(node, siblings) {
  if (!shapeTypes.has(node.type) || hasContent(node) || node.children?.length) return null;
  const a = node.absoluteBoundingBox;
  if (!a || a.width <= 0 || a.height <= 0) return null;
  return siblings.filter((n) => n !== node && n.visible !== false && n.children?.length && hasContent(n) && n.absoluteBoundingBox)
    .filter((n) => { const b = n.absoluteBoundingBox; return a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1; })
    .sort((x, y) => x.absoluteBoundingBox.width * x.absoluteBoundingBox.height - y.absoluteBoundingBox.width * y.absoluteBoundingBox.height)[0] || null;
}
