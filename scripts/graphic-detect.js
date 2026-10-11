/**
 * Shared "is this subtree a single exportable graphic" rule.
 *
 * Both stage 1 (decides what to export as one SVG/PNG asset) and stage 2 (decides what
 * to strip out of the raw Figma JSON before it goes in the LLM prompt - an icon's 200
 * individual vector path points are not useful context, they're just noise the model
 * pays to read) need the EXACT same answer to "is this node a single graphic asset".
 * This file is the one place that decision is made, so the two stages can't drift apart.
 *
 * A "graphic" is a subtree with NO text and NO photo fills that contains at least one
 * vector shape (plus plain rectangles/groups/frames). The caller is expected to stop
 * descending once isGraphicNode() returns true for a node - that node IS the asset.
 */
// REGULAR_POLYGON is the type the Figma API reports for a polygon (triangle, pentagon...). "POLYGON" is not a Figma node type, so before this a
// circle badge with a pointer triangle under it (ellipse + polygon + icon) was never seen as one graphic, and the triangle was dropped.
const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "ELLIPSE", "REGULAR_POLYGON", "POLYGON", "LINE"]);
const PLAIN_TYPES = new Set(["RECTANGLE"]);
const CONTAINERS = new Set(["GROUP", "FRAME", "COMPONENT", "INSTANCE", "SECTION"]);
const MAX_GRAPHIC = 700; // px; bigger things are treated as layout and we look inside them instead
const MAX_PURE_VECTOR = 2400; // px; a group made only of vector shapes is one graphic up to this size
const MIN_SIDE = 8; // px; anything whose longest side is smaller is a fragment, not an asset

export function hasImageFill(node) {
  return (node.fills || []).some((f) => f.type === "IMAGE" && f.visible !== false);
}

// returns { ok, vectors } for the subtree: ok=true means "pure graphic material so far"
function graphicInfo(node) {
  if (node.visible === false) return { ok: true, vectors: 0, rects: 0 };
  if (node.type === "TEXT" || hasImageFill(node)) return { ok: false, vectors: 0 };
  if (VECTOR_TYPES.has(node.type)) return { ok: true, vectors: 1, rects: 0 };
  if (PLAIN_TYPES.has(node.type)) return { ok: true, vectors: 0, rects: 1 };
  if (!CONTAINERS.has(node.type)) return { ok: false, vectors: 0 };
  let vectors = 0, rects = 0;
  for (const c of node.children || []) {
    const r = graphicInfo(c);
    if (!r.ok) return { ok: false, vectors: 0, rects: 0 };
    vectors += r.vectors; rects += r.rects || 0;
  }
  return { ok: true, vectors, rects };
}

/**
 * True if `node` is itself the root of a single exportable graphic (an icon, logo, or
 * illustration built from vector shapes). Returns the vector count too, since callers
 * find that useful to log/display.
 */
export function isGraphicNode(node) {
  const box = node.absoluteBoundingBox;
  if (!box || node.type === "TEXT" || hasImageFill(node)) return { isGraphic: false, vectors: 0 };
  const longest = Math.max(box.width, box.height);
  const shortest = Math.min(box.width, box.height);
  const g = graphicInfo(node);
  // Bigger than MAX_GRAPHIC is layout - unless it is nothing but vector shapes (a curve line across the page, a wave): there is no
  // layout inside it to look at, and walking into it exported only its 20px end dots and dropped the curve itself.
  const sizeOk = longest <= MAX_GRAPHIC || (g.rects === 0 && longest <= MAX_PURE_VECTOR);
  const isGraphic = g.ok && g.vectors > 0 && sizeOk && longest >= MIN_SIDE && shortest >= 2;
  return { isGraphic, vectors: g.vectors };
}