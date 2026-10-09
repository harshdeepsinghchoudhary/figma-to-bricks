/**
 * Shared rule (stage 1 exports, stage 3 places): find "panels" - shape-only groups that sit BEHIND content, e.g. a yellow card
 * made of a rectangle + a masked pattern + a vector. A panel gives the card its fill/radius, and every other shape in it
 * becomes a decoration LAYER, drawn as a ::before / ::after pseudo-element background image on the card (or section).
 *
 *   panel      = shape-only container (no TEXT, no photo fill), at least MIN_W wide. Single-child wrapper groups are walked through.
 *   background = a child RECTANGLE with a solid fill covering the panel; supplies colour + corner radius.
 *   layers     = every other visible child of the panel; each is exported as ONE svg and used as a pseudo-element background.
 */
import { hasImageFill } from "./graphic-detect.js";

const SHAPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "ELLIPSE", "REGULAR_POLYGON", "POLYGON", "LINE", "RECTANGLE"]);
const CONT = new Set(["GROUP", "FRAME", "COMPONENT", "INSTANCE", "SECTION"]);
const MIN_W = 300, MIN_H = 60, MAX_LAYERS = 2;

export function shapeOnly(n) {
  if (n.visible === false) return true;
  if (n.type === "TEXT" || hasImageFill(n)) return false;
  if (SHAPES.has(n.type)) return true;
  if (!CONT.has(n.type)) return false;
  return (n.children || []).every(shapeOnly);
}
const vectors = (n) => (n.type !== "RECTANGLE" && SHAPES.has(n.type) ? 1 : 0) + (n.children || []).reduce((s, c) => s + (c.visible === false ? 0 : vectors(c)), 0);
const box = (n) => n.absoluteBoundingBox;
const solid = (n) => (n.fills || []).find((f) => f.type === "SOLID" && f.visible !== false);
export const hexOf = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

export function findPanels(root) {
  const out = [];
  const taken = new Set();
  (function walk(n) {
    if (!n || n.visible === false || taken.has(n.id)) return;
    if (CONT.has(n.type) && box(n) && box(n).width >= MIN_W && box(n).height >= MIN_H && shapeOnly(n)) {
      let p = n;
      while ((p.children || []).filter((c) => c.visible !== false).length === 1 && CONT.has(p.children[0].type)) p = p.children[0];
      const kids = (p.children || []).filter((c) => c.visible !== false);
      const bg = kids.find((c) => c.type === "RECTANGLE" && !c.isMask && solid(c) && box(c) && Math.abs(box(c).width - box(p).width) <= 2 && Math.abs(box(c).height - box(p).height) <= 2);
      if (bg) {
        const layers = kids.filter((c) => c !== bg && vectors(c) > 0).slice(0, MAX_LAYERS);
        const mark = (x) => { taken.add(x.id); (x.children || []).forEach(mark); }; mark(n);
        out.push({
          id: p.id, box: box(p),
          bg: { nodeId: bg.id, color: hexOf(solid(bg).color), radius: bg.cornerRadius ?? (bg.rectangleCornerRadii ? Math.max(...bg.rectangleCornerRadii) : 0) },
          layers: layers.map((l) => ({ id: l.id, name: l.name, type: l.type, w: Math.round(box(l).width), h: Math.round(box(l).height), box: box(l) })),
          dropped: kids.filter((c) => c !== bg && vectors(c) > 0).length - layers.length,
        });
        return;
      }
    }
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}