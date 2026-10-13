/**
 * Structure rules (stage 3, deterministic, no LLM): turn the normalized tree into the SMALLEST tree that still renders the same as the
 * Figma frame, and repair what the model step (or its rate-limited fallback model) got wrong. Called by structure-pass.js, before
 * responsive-pass.js, so every existing normalized.json benefits without another model run.
 *
 * Why it exists. The model (and the XY-cut grouping feeding it) emits one wrapper per Figma group/frame plus one synthetic row/column per
 * measured band. Most carry no styling and no purpose; rows of cards that are really a grid stay rows; decoration (dotted lines, badges
 * on pictures, corner vectors) is forced into the flow and distorts the layout around it; a whole column can come back typed
 * "unsupported". Comparing compiler output with a hand-corrected file showed ~40 such defects per page, and a render of the compiled
 * tree (tools/render.py) showed text landing up to 800px away from where Figma has it.
 *
 * Every rule is a general design principle measured from the Figma geometry. None of them knows this page.
 *
 *   H  hoist        a section whose only child is a full-bleed filled group: the fill, the vertical padding and the layout belong to the
 *                   SECTION (the horizontal padding was only the distance to the page edge, which the centred container already provides)
 *   B  dividers     a LINE on the edge of its parent becomes that parent's border-top/-bottom/-left/-right
 *   U  unsupported  an element the model typed "unsupported" that really holds text or pictures is rebuilt from the Figma data
 *   T  text         a visible Figma TEXT node that no element stands for is put back where its geometry says it belongs
 *   F  decoration   (1) small items lying on a sibling picture are layers on it; (2) a media-only child that overlaps its siblings,
 *                   or a strip of icons pushed hundreds of px by margins, is positioned absolutely instead of forced into the flow;
 *                   the parent's gaps and alignment are then measured again from what is left
 *   D  wrappers     a wrapper is removed only when it has no fill, border, shadow, padding, margin, size or note of its own AND its
 *                   child keeps exactly the same placement. D1 unwrap, D2 absorb into a styled parent, D3 flatten same-flow nesting
 *   G  grids        consecutive rows of equal cards, or any set of equal cards laid out in rows x columns, become ONE grid
 *   S  spanning     a card that spans its parent's content width says "fill" (a column with align:start would shrink it to its text)
 *   R  roles        the title of a repeated card is a heading in every card, not only in the ones the model happened to tag
 *   Z  sanity       an offset that is wider than its parent can ever be (a 1180px margin) is positioning, never spacing: it is removed
 *                   and reported, so it can no longer push the page into horizontal scrolling
 *
 * The normalized schema is unchanged. The rules read and write the existing fields (layout, size, border, ...) plus a few compile-only
 * flags: border.sides, abs, _relative, _grid, layout.gridRowGap.
 */

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const isNum = (v) => typeof v === "number" && isFinite(v);
const SIDES = ["top", "right", "bottom", "left"];
export const CONTAINER_TYPES = new Set(["row", "column", "block", "container"]);
const TEXTY = new Set(["heading", "text", "text-basic"]);
const MEDIA = new Set(["image", "icon"]);
const LEAVES = new Set(["heading", "text", "text-basic", "button", "image", "icon", "unsupported", "spacer"]);

/** Tolerances: each is a measured threshold, not a design-specific number. */
export const TOL = {
  px: 2.5,          // two edges closer than this are "the same edge"
  rowY: 4,          // cards whose tops differ by less than this share a grid row
  sizePct: 0.02,    // equal card widths (fraction)
  gapPx: 1.5,       // equal gaps
  inside: 0.85,     // fraction of a layer's area that must lie inside the picture it sits on
  span: 0.97,       // a child this fraction of its parent's content width "spans" it
  decorIcon: 64,    // largest item (px) that can be pure decoration
  bleed: 0.95,      // a box this fraction of the page width is full-bleed
};

// ----------------------------------------------------------------------------------------------
// Figma index: id -> { type, box, parent, fills, strokes, characters, style, children[], asset }
// ----------------------------------------------------------------------------------------------
export function buildFigmaIndex(root, assetIds = new Set()) {
  const idx = {};
  (function walk(n, parent) {
    if (!n || typeof n !== "object") return;
    const b = n.absoluteBoundingBox;
    if (n.id) {
      idx[n.id] = {
        id: n.id, name: n.name, type: n.type, parent, visible: n.visible !== false, isMask: !!n.isMask,
        box: b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null,
        fills: n.fills, strokes: n.strokes, strokeWeight: n.strokeWeight, characters: n.characters, style: n.style,
        cornerRadius: n.cornerRadius, layoutMode: n.layoutMode, itemSpacing: n.itemSpacing, effects: n.effects, counterAxisAlignItems: n.counterAxisAlignItems, primaryAxisAlignItems: n.primaryAxisAlignItems, layoutWrap: n.layoutWrap,
        pad: { top: n.paddingTop, right: n.paddingRight, bottom: n.paddingBottom, left: n.paddingLeft }, radii: n.rectangleCornerRadii,
        children: (n.children || []).map((c) => c.id), asset: assetIds.has(n.id),
      };
    }
    for (const c of n.children || []) walk(c, n.id);
  })(root, null);
  return idx;
}

const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
function solidHex(paint) {
  if (!paint || paint.visible === false || paint.type !== "SOLID" || !paint.color) return null;
  const a = (paint.opacity ?? 1) * (paint.color.a ?? 1);
  if (a <= 0) return null;
  return toHex(paint.color) + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase() : "");
}
const unionOf = (rs) => {
  rs = rs.filter(Boolean);
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * boxOf(node): the Figma box a normalized element occupies - its own Figma node, else its exported graphic, else the union of its children.
 * A container never takes the box of a TEXT node or an exported graphic (the model sometimes reuses a leaf's id on a wrapper).
 */
export function makeBoxer(figma) {
  const wrongKind = (n, f) => f && CONTAINER_TYPES.has(n.type) && (f.type === "TEXT" || f.asset);
  const hasOwnBox = (n) => { const f = n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId]; return !!(f?.box && !wrongKind(n, f)); };
  function boxOf(n) {
    const f = n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId];
    if (f?.box && !wrongKind(n, f)) return f.box;
    if (n.asset?.nodeId && figma[n.asset.nodeId]?.box) return figma[n.asset.nodeId].box;
    const kids = n.children || [];
    const shown = kids.filter((c) => c.type !== "unsupported" && !c.abs);
    return unionOf((shown.length ? shown : kids.filter((c) => !c.abs)).map(boxOf));
  }
  return { boxOf, hasOwnBox, union: unionOf };
}

// ----------------------------------------------------------------------------------------------
export function applyStructureRules(input, { figma = {}, rootBox = null, manifest = [], enable = {}, claimed = new Set() } = {}) {
  const on = (k) => enable[k] !== false;
  const doc = JSON.parse(JSON.stringify(input));
  const report = [];
  const log = (m) => report.push(m);
  const stats = {};
  const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n; };
  if (!Object.keys(figma).length) return { doc, report: ["no Figma geometry available - structure rules skipped"], stats };

  const usedIds = new Set();
  (function collect(n) { if (n?.id) usedIds.add(n.id); for (const c of n?.children || []) collect(c); })({ children: doc.children });
  const fresh = (base) => { let i = 1, id; do { id = `${base}-${i++}`; } while (usedIds.has(id)); usedIds.add(id); return id; };

  const { boxOf, hasOwnBox } = makeBoxer(figma);
  const pageW = rootBox?.w ?? 1440;
  const rendered = (n) => (n.children || []).filter((c) => c.type !== "unsupported" && !c.abs);

  // ---------------- basic predicates ----------------
  const padOf = (n) => n.layout?.padding || {};
  const padSum = (n, a, b) => (padOf(n)[a] || 0) + (padOf(n)[b] || 0);
  const contentWidth = (n) => { const b = boxOf(n); return b ? b.w - padSum(n, "left", "right") : null; };
  const hasPad = (n) => SIDES.some((s) => (padOf(n)[s] || 0) > 0.5);
  const hasMargin = (n) => SIDES.some((s) => Math.abs(n.layout?.margin?.[s] || 0) > 0.5);
  const hasVisual = (n) => !!(n.background || n.border || n.boxShadow || n.asset || n._bgImage);
  const hasSize = (n) => !!n.size && Object.keys(n.size).length > 0;
  const hasNotes = (n) => Array.isArray(n.notes) && n.notes.length > 0;
  const isPure = (n, { margin = false, size = false } = {}) =>
    CONTAINER_TYPES.has(n.type) && !hasVisual(n) && !hasPad(n) && !n.responsive && !n.abs && !n._relative && !n.href
    && (margin || !hasMargin(n)) && (size || !hasSize(n));
  const gapOf = (n) => n.layout?.gap ?? n.layout?.columnGap ?? n.layout?.rowGap ?? 0;
  const dirOf = (n) => n.layout?.direction || (n.type === "row" ? "row" : n.type === "column" ? "column" : undefined);
  const effAlign = (n) => n.layout?.align ?? "stretch";
  const hasText = (n) => TEXTY.has(n.type) || n.type === "button" || (n.children || []).some(hasText);
  const addSides = (a = {}, b = {}) => {
    const out = {};
    for (const s of SIDES) { const v = (a[s] || 0) + (b[s] || 0); if (Math.abs(v) > 0.001) out[s] = r2(v); }
    return Object.keys(out).length ? out : undefined;
  };
  const mergeNotes = (...ns) => { const all = ns.flat().filter((x) => typeof x === "string"); return all.length ? [...new Set(all)] : undefined; };
  const setLayout = (n, patch) => {
    n.layout = { ...(n.layout || {}), ...patch };
    for (const k of Object.keys(n.layout)) if (n.layout[k] === undefined) delete n.layout[k];
    if (!Object.keys(n.layout).length) delete n.layout;
  };
  const dropMargin = (c, sides = SIDES) => {
    if (!c.layout?.margin) return;
    for (const s of sides) delete c.layout.margin[s];
    if (!Object.keys(c.layout.margin).length) delete c.layout.margin;
    if (!Object.keys(c.layout).length) delete c.layout;
  };

  // ---------------- the Figma band a section occupies ----------------
  const topOf = (id) => { let cur = id; while (figma[cur]?.parent && figma[figma[cur].parent]?.parent) cur = figma[cur].parent; return cur; };
  function sectionBand(sec) {
    const ids = new Set();
    (function walk(n) {
      if (n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId]) ids.add(n.figmaNodeId);
      if (n.asset?.nodeId && figma[n.asset.nodeId]) ids.add(n.asset.nodeId);
      for (const c of n.children || []) walk(c);
    })(sec);
    const tops = [...new Set([...ids].map(topOf))];
    return { ids, tops, box: unionOf(tops.map((t) => figma[t]?.box)) };
  }

  // ====================================================================================================
  // measureFlow: gaps, margins and alignment of a container, measured again from the boxes of the children that are in the flow.
  // (the same measuring normalize-postprocess.js does, repeated because the flow changed after it ran)
  // ====================================================================================================
  function measureFlow(n) {
    const dir = dirOf(n);
    if (!dir || n.layout?.display === "grid") return false;
    const flow = rendered(n);
    if (!flow.length) return false;
    const boxes = flow.map(boxOf);
    if (boxes.some((b) => !b)) return false;
    const [mainPos, mainLen, crossPos, crossLen] = dir === "row" ? ["x", "w", "y", "h"] : ["y", "h", "x", "w"];
    const [lead, trail, crossLead] = dir === "row" ? ["left", "right", "top"] : ["top", "bottom", "left"];
    for (let i = 1; i < flow.length; i++) if (boxes[i][mainPos] < boxes[i - 1][mainPos] + boxes[i - 1][mainLen] - 0.5) return false;
    flow.forEach((c) => dropMargin(c, [lead, trail]));
    const gaps = [];
    for (let i = 1; i < flow.length; i++) gaps.push(Math.max(0, boxes[i][mainPos] - (flow[i]._sepLead || 0) - (boxes[i - 1][mainPos] + boxes[i - 1][mainLen])));
    const patch = { gap: undefined, rowGap: undefined, columnGap: undefined };
    const keepSB = n.layout?.justify === "space-between";
    if (!keepSB) {
      if (gaps.length && gaps.every((g) => Math.abs(g - gaps[0]) <= 1)) { if (gaps[0] > 0.5) patch.gap = r2(gaps.reduce((a, b) => a + b, 0) / gaps.length); }
      else gaps.forEach((g, i) => { if (g > 0.5) { const c = flow[i + 1]; c.layout = { ...(c.layout || {}), margin: { ...(c.layout?.margin || {}), [lead]: r2(g) } }; } });
    }
    const content = unionOf(boxes);
    const cStart = content[crossPos], cEnd = content[crossPos] + content[crossLen];
    const tol = Math.max(6, 0.01 * (cEnd - cStart));
    const starts = boxes.map((r) => r[crossPos]);
    const ends = boxes.map((r) => r[crossPos] + r[crossLen]);
    const centers = boxes.map((r) => r[crossPos] + r[crossLen] / 2);
    const all = (arr, v) => arr.every((x) => Math.abs(x - v) <= tol);
    flow.forEach((c) => dropMargin(c, [crossLead, dir === "row" ? "bottom" : "right"]));
    // when the container has its own Figma box, "centred" means centred in THAT box (a footer's content centred on the page)
    const own = hasOwnBox(n) ? boxOf(n) : null;
    const ownCenter = own ? own[crossPos] + own[crossLen] / 2 : null;
    if (all(starts, cStart)) patch.align = flow.length === 1 && own && Math.abs((cStart + cEnd) / 2 - ownCenter) <= tol && Math.abs(cStart - own[crossPos]) > tol ? "center" : "start";
    else if (all(centers, (cStart + cEnd) / 2)) patch.align = "center";
    else if (all(ends, cEnd)) patch.align = "end";
    else {
      patch.align = "start";
      boxes.forEach((r, i) => { const off = r[crossPos] - cStart; if (off > 0.5) flow[i].layout = { ...(flow[i].layout || {}), margin: { ...(flow[i].layout?.margin || {}), [crossLead]: r2(off) } }; });
    }
    setLayout(n, patch);
    return true;
  }

  // ====================================================================================================
  // H  hoist a full-bleed filled group into its section
  // ====================================================================================================
  function hoist(sec) {
    for (let guard = 0; guard < 2; guard++) {
      const kids = rendered(sec);
      if (kids.length !== 1) return;
      const g = kids[0];
      if (!CONTAINER_TYPES.has(g.type) || !hasOwnBox(g)) return;
      const b = boxOf(g);
      if (b.w < pageW * TOL.bleed) return;
      if (sec.background || sec._bgImage) return;
      if (!(g.background) || g.border || g.boxShadow || g.asset || g._bgImage || g.responsive || g.abs || g.href) return;
      if (isNum(g.size?.width) && g.size.width < pageW * TOL.bleed) return;
      const keepTopBottom = { top: padOf(g).top, bottom: padOf(g).bottom };
      sec.background = g.background;
      sec.layout = {
        ...(sec.layout || {}), ...(g.layout || {}),
        padding: Object.fromEntries(Object.entries(keepTopBottom).filter(([, v]) => v)),
        margin: addSides(sec.layout?.margin, g.layout?.margin),
      };
      for (const k of ["padding", "margin"]) if (!sec.layout[k] || !Object.keys(sec.layout[k]).length) delete sec.layout[k];
      sec.layout.display = "flex";
      if (g.size) { sec.size = { ...(sec.size || {}) }; }
      sec.notes = mergeNotes(sec.notes, g.notes); if (!sec.notes) delete sec.notes;
      sec.children = g.children;
      log(`section ${sec.id}: full-bleed group ${g.id} hoisted into the section (fill ${g.background.color || "gradient"}, vertical padding ${keepTopBottom.top ?? 0}/${keepTopBottom.bottom ?? 0}; horizontal padding ${padOf(g).left ?? 0}/${padOf(g).right ?? 0} is the distance to the page edge)`);
      bump("hoisted");
    }
  }

  // ====================================================================================================
  // B  divider lines -> parent border
  // ====================================================================================================
  function dividersToBorders(n) {
    for (const c of n.children || []) dividersToBorders(c);
    if (!(CONTAINER_TYPES.has(n.type) || n.type === "section") || !n.children?.length) return;
    const pb = hasOwnBox(n) ? boxOf(n) : null;
    if (!pb) return;
    for (const c of [...n.children]) {
      if (c.type !== "unsupported") continue;
      const f = c.figmaNodeId && figma[c.figmaNodeId];
      if (!f?.box || !["LINE", "VECTOR", "RECTANGLE"].includes(f.type)) continue;
      const stroke = (f.strokes || []).find((s) => s.visible !== false && s.type === "SOLID");
      const fill = (f.fills || []).find((s) => s.visible !== false && s.type === "SOLID");
      const hex = solidHex(stroke) || solidHex(fill);
      const thin = Math.min(f.box.w, f.box.h) <= 6;
      const w = f.type === "RECTANGLE" || !stroke ? Math.min(f.box.w, f.box.h) : f.strokeWeight || 1;
      if (!hex || !(w > 0) || w > 6 || !thin) continue;
      const horizontal = f.box.w >= f.box.h;
      let side = null;
      if (horizontal && f.box.w >= pb.w * 0.9) {
        if (Math.abs(f.box.y - pb.y) <= TOL.px) side = "top";
        else if (Math.abs(f.box.y + f.box.h - (pb.y + pb.h)) <= TOL.px) side = "bottom";
      } else if (!horizontal && f.box.h >= pb.h * 0.9) {
        if (Math.abs(f.box.x - pb.x) <= TOL.px) side = "left";
        else if (Math.abs(f.box.x + f.box.w - (pb.x + pb.w)) <= TOL.px) side = "right";
      }
      if (!side || n.border?.color) continue;
      n.border = { ...(n.border || {}), color: hex, width: r2(w), sides: [side] };
      n.children = n.children.filter((x) => x !== c);
      log(`${n.id}: ${side} border ${r2(w)}px ${hex} from divider ${c.figmaNodeId}`);
      bump("dividers");
    }
  }


  // ====================================================================================================
  // B2  thin separator lines between siblings (the "|" between footer links, rules between list rows) -> border on the next sibling
  // ====================================================================================================
  function separatorsToBorders(n) {
    for (const c of n.children || []) separatorsToBorders(c);
    if (!(CONTAINER_TYPES.has(n.type) || n.type === "section") || (n.children || []).length < 3) return;
    const dir = dirOf(n);
    if (!dir || n.layout?.display === "grid") return;
    const kids = n.children;
    // a separator the model left out altogether is still a Figma child of this frame: treat it as a skipped line
    const own = n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId];
    const have = new Set(); (function g(x) { if (x.figmaNodeId) have.add(x.figmaNodeId); for (const k of x.children || []) g(k); })(n);
    const virtual = [];
    if (own?.children && hasOwnBox(n)) for (const id of own.children) {
      const fc = figma[id];
      if (fc && fc.type === "LINE" && fc.visible !== false && !have.has(id) && !claimed.has(id)) virtual.push({ type: "unsupported", id: `sep-${id}`, figmaNodeId: id, _virtual: true });
    }
    // place each virtual line where it sits in the flow
    for (const v of virtual) {
      const vb = figma[v.figmaNodeId].box; if (!vb) continue;
      const dirRow = dir === "row";
      let at = kids.findIndex((k) => { const kb = k.type === "unsupported" ? null : boxOf(k); return kb && (dirRow ? kb.x : kb.y) > (dirRow ? vb.x : vb.y); });
      if (at < 0) at = kids.length;
      kids.splice(at, 0, v);
    }
    for (const c of [...kids]) {
      if (c.type !== "unsupported") continue;
      const f = c.figmaNodeId && figma[c.figmaNodeId];
      if (!f?.box || !["LINE", "VECTOR", "RECTANGLE"].includes(f.type)) continue;
      const stroke = (f.strokes || []).find((s) => s.visible !== false && s.type === "SOLID");
      const fill = (f.fills || []).find((s) => s.visible !== false && s.type === "SOLID");
      const hex = solidHex(stroke) || solidHex(fill);
      const w = f.type === "RECTANGLE" || !stroke ? Math.min(f.box.w, f.box.h) : f.strokeWeight || 1;
      const vertical = f.box.h > f.box.w;
      if (!hex || !(w > 0) || w > 6 || (vertical ? f.box.w : f.box.h) > 6) continue;
      if ((dir === "row") !== vertical) continue; // a line across the flow direction only
      const i = kids.indexOf(c);
      const prev = kids.slice(0, i).reverse().find((k) => k.type !== "unsupported" && !k.abs);
      const next = kids.slice(i + 1).find((k) => k.type !== "unsupported" && !k.abs);
      const pb = prev && boxOf(prev), nb = next && boxOf(next);
      if (!pb || !nb || next.border?.color) continue;
      const side = vertical ? "left" : "top";
      const lead = vertical ? nb.x - f.box.x : nb.y - f.box.y; // line start -> next sibling's own start
      const after = vertical ? nb.x - (f.box.x + f.box.w) : nb.y - (f.box.y + f.box.h);
      const before = vertical ? f.box.x - (pb.x + pb.w) : f.box.y - (pb.y + pb.h);
      if (lead <= 0 || before < 0 || after < 0 || Math.abs(before - after) > 2) continue; // symmetric spacing only
      next.border = { ...(next.border || {}), color: hex, width: r2(w), sides: [side] };
      next.layout = { ...(next.layout || {}), padding: { ...(next.layout?.padding || {}), [side]: r2(after) } };
      next._sepLead = r2(lead);
      n.children = n.children.filter((x) => x !== c);
      log(`${next.id}: ${side} border ${r2(w)}px ${hex} + ${r2(after)}px padding from separator ${c.figmaNodeId}`);
      bump("separators");
    }
  }

  // ====================================================================================================
  // U  rebuild "unsupported" elements that really hold content, and T  recover missing text
  // ====================================================================================================
  const manifestById = new Map(manifest.map((a) => [a.nodeId, a]));
  const typographyOf = (f) => {
    const st = f.style || {};
    const fill = solidHex((f.fills || []).find((p) => p.visible !== false));
    const lh = st.lineHeightPx ? `${r2(st.lineHeightPx)}px` : undefined;
    const t = {
      fontFamily: st.fontFamily, fontSize: st.fontSize, fontWeight: st.fontWeight, ...(lh ? { lineHeight: lh } : {}), ...(fill ? { color: fill } : {}),
      ...({ LEFT: { align: "left" }, CENTER: { align: "center" }, RIGHT: { align: "right" } }[st.textAlignHorizontal] || {}),
      ...({ UPPER: { textTransform: "uppercase" }, LOWER: { textTransform: "lowercase" }, TITLE: { textTransform: "capitalize" } }[st.textCase] || {}),
    };
    for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
    return t;
  };
  const textEl = (f) => {
    const st = f.style || {};
    const long = f.characters.length > 120 || f.characters.includes("\n");
    const el = {
      type: long ? "text" : (st.fontSize >= 22 && Number(st.fontWeight) >= 600 ? "heading" : "text-basic"),
      id: fresh("text"), figmaNodeId: f.id, text: f.characters.replace(/\u00a0/g, " ").replace(/\u2028/g, "\n"), typography: typographyOf(f),
    };
    if (el.type === "heading") el.level = 3;
    if (f.box) el.size = { width: r2(f.box.w) };
    return el;
  };
  const hasContent = (fid) => {
    const f = figma[fid];
    if (!f || !f.visible) return false;
    if (f.type === "TEXT") return !!String(f.characters || "").trim();
    if (f.asset) return true;
    return f.children.some(hasContent);
  };
  // a Figma subtree -> normalized elements (frames with auto layout keep their direction, loose groups take it from the geometry)
  function buildFromFigma(fid) {
    const f = figma[fid];
    if (!f || !f.visible) return null;
    if (f.type === "TEXT") return String(f.characters || "").trim() ? textEl(f) : null;
    if (f.asset) {
      const m = manifestById.get(fid);
      const svg = m ? /\.svg$/i.test(m.file) : false;
      const small = f.box && f.box.w <= 48 && svg;
      return { type: small ? "icon" : "image", id: fresh(small ? "icon" : "image"), figmaNodeId: fid, asset: { nodeId: fid, kind: svg ? "svg" : "image" }, ...(f.box ? { size: { width: r2(f.box.w), height: r2(f.box.h) } } : {}) };
    }
    const kids = f.children.map(buildFromFigma).filter(Boolean);
    if (!kids.length) return null;
    if (kids.length === 1 && f.type === "GROUP") return kids[0];
    const boxes = kids.map(boxOf);
    const stacked = boxes.every((b, i) => i === 0 || b.y >= boxes[i - 1].y + boxes[i - 1].h - 1);
    const dir = f.layoutMode === "HORIZONTAL" ? "row" : f.layoutMode === "VERTICAL" ? "column" : stacked ? "column" : "row";
    // Figma lists the layers of a loose group in stacking order, not reading order: sort by position along the flow
    if (!f.layoutMode || f.layoutMode === "NONE") { const key = dir === "row" ? "x" : "y"; kids.sort((a, b) => (boxOf(a)?.[key] ?? 0) - (boxOf(b)?.[key] ?? 0)); }
    const el = { type: dir, id: fresh(`rebuilt-${dir}`), figmaNodeId: fid, layout: { display: "flex", direction: dir }, children: kids };
    const cr = f.cornerRadius, fill = solidHex((f.fills || []).find((p) => p.visible !== false));
    if (fill && f.type !== "GROUP") el.background = { color: fill };
    if (cr > 0 && el.background) el.border = { radius: cr };
    measureFlow(el);
    return el;
  }
  const sectionHasAsset = (id) => { let hit = false; (function w(n) { if (n.asset?.nodeId === id) hit = true; for (const c of n.children || []) w(c); })({ children: doc.children }); return hit; };
  function rebuildUnsupported(n) {
    if (!n.children) return;
    n.children = n.children.map((c) => {
      if (c.type === "unsupported") {
        const fid = c.figmaNodeId;
        // a shape the model called "unsupported" that the extractor exported as a graphic (the curve line across a section): use the picture
        let ga = fid && figma[fid] ? fid : null;
        while (ga && !figma[ga].asset && figma[ga].parent) ga = figma[ga].parent;
        if (ga && figma[ga]?.asset && figma[ga].visible && manifestById.has(ga) && !sectionHasAsset(ga)) {
          const el = buildFromFigma(ga);
          if (el) { log(`${c.id}: typed "unsupported" but ${ga} is an exported graphic - placed as ${el.type}`); bump("rebuilt"); return el; }
        }
        if (fid && figma[fid] && !["LINE", "VECTOR", "ELLIPSE", "STAR", "BOOLEAN_OPERATION"].includes(figma[fid].type) && hasContent(fid)) {
          const el = buildFromFigma(fid);
          if (el) {
            log(`${c.id}: typed "unsupported" but holds text/pictures in Figma (${fid}) - rebuilt from the Figma data`);
            bump("rebuilt");
            return el;
          }
        }
        return c;
      }
      rebuildUnsupported(c);
      return c;
    });
  }
  // ids of the Figma nodes a section already stands for (a leaf stands for its whole subtree, a heading only for the texts it contains)
  function coverage(sec) {
    const present = new Set();
    const addSubtree = (id) => { present.add(id); for (const c of figma[id]?.children || []) addSubtree(c); };
    const norm = (x) => String(x || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    (function walk(n) {
      if (n.figmaNodeId && n.figmaNodeId !== "scope") present.add(n.figmaNodeId);
      if (n.asset?.nodeId) present.add(n.asset.nodeId);
      if (n.type === "unsupported" && n.figmaNodeId && figma[n.figmaNodeId]) addSubtree(n.figmaNodeId); // a skipped divider/shape stands for itself only
      if (n.type !== "section" && !CONTAINER_TYPES.has(n.type)) {
        if (n.asset?.nodeId && figma[n.asset.nodeId]) addSubtree(n.asset.nodeId);
        if (n.figmaNodeId && figma[n.figmaNodeId]) {
          if (!TEXTY.has(n.type)) addSubtree(n.figmaNodeId);   // a button / picture stands for everything inside it
          else {
            // a heading/text that carries the id of a FRAME stands only for the TEXT nodes whose copy it contains
            const mine = norm(n.text);
            (function dfs(id) { const f = figma[id]; if (!f) return; if (f.type === "TEXT") { if (mine.includes(norm(f.characters))) present.add(id); return; } for (const c of f.children) dfs(c); })(n.figmaNodeId);
          }
        }
      }
      for (const c of n.children || []) walk(c);
    })(sec);
    return present;
  }
  function recoverMissingText(sec, present = coverage(sec)) {
    const used = [...present].filter((id) => figma[id]);
    const missing = [];
    const seen = new Set();
    for (const rid of used) {
      const f = figma[rid];
      if (f.type === "TEXT" || f.asset) continue;
      (function dfs(id) {
        const g = figma[id];
        if (!g || seen.has(id) || !g.visible || g.asset) return;
        if (g.type === "TEXT") { seen.add(id); if (!present.has(id) && String(g.characters || "").trim() && g.box) missing.push(g); return; }
        for (const c of g.children) dfs(c);
      })(rid);
    }
    for (const t of missing) {
      let host = null, hostArea = Infinity;
      (function walk(n) {
        if (CONTAINER_TYPES.has(n.type)) {
          const b = hasOwnBox(n) ? boxOf(n) : null;
          if (b && t.box.x >= b.x - 1 && t.box.y >= b.y - 1 && t.box.x + t.box.w <= b.x + b.w + 1 && t.box.y + t.box.h <= b.y + b.h + 1 && b.w * b.h < hostArea) { host = n; hostArea = b.w * b.h; }
        }
        for (const c of n.children || []) walk(c);
      })(sec);
      if (!host) { log(`missing text "${t.characters.slice(0, 40)}" (${t.id}) could not be placed: no container holds it`); continue; }
      const el = textEl(t);
      const dir = dirOf(host) || "column";
      let at = host.children.length;
      for (let i = 0; i < host.children.length; i++) {
        const kb = host.children[i].type === "unsupported" ? null : boxOf(host.children[i]);
        if (kb && (dir === "column" ? kb.y > t.box.y + t.box.h / 2 : kb.x > t.box.x + t.box.w / 2)) { at = i; break; }
      }
      host.children.splice(at, 0, el);
      measureFlow(host);
      log(`recovered text "${t.characters.slice(0, 40)}" (${t.id}) into ${host.id} at position ${at}`);
      bump("recoveredText");
    }
  }

  // ====================================================================================================
  // V  fills must exist in Figma, I  recover icons / pictures the model dropped
  // ====================================================================================================
  const rgbOf = (h) => String(h || "").slice(0, 7).toUpperCase();
  const solidRgbs = (f) => (f.fills || []).map(solidHex).filter(Boolean).map(rgbOf);
  // is there a visible, un-masked solid fill of this colour under n's box (n itself, below it, or the shapes beside it that form its card)?
  function fillSupported(n, colour) {
    const f = n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId];
    if (!f || !f.box || f.type === "TEXT" || f.asset) return true; // nothing to check against
    const want = rgbOf(colour), nb = f.box, need = area(nb) * 0.85;
    let scope = f.id;
    for (let i = 0; i < 2 && figma[scope]?.parent; i++) scope = figma[scope].parent;
    let ok = false;
    (function dfs(id) {
      const g = figma[id];
      if (!g || ok || !g.visible) return;
      if (!g.isMask && g.box && g.type !== "TEXT" && solidRgbs(g).includes(want) && inter(g.box, nb) >= need) { ok = true; return; }
      for (const c of g.children) dfs(c);
    })(scope);
    return ok;
  }
  // a picture (not a graphic) that covers the whole element hides whatever fill is under it
  const pictureCovers = (n) => {
    const nb = hasOwnBox(n) ? boxOf(n) : null;
    if (!nb) return false;
    return mediaLeaves(n).some((l) => { const lb = boxOf(l); return lb && l.type === "image" && inter(lb, nb) >= area(nb) * 0.95; });
  };
  function reconcileFills(n) {
    for (const c of n.children || []) reconcileFills(c);
    const col = n.background?.color;
    if (!col || typeof col !== "string" || !/^#[0-9a-f]{6}/i.test(col) || n.type === "section") return;
    const fig = n.figmaNodeId && n.figmaNodeId !== "scope" && figma[n.figmaNodeId];
    // a TEXT node's fill is the colour of its letters, and a picture's fill is the picture: neither is a background behind it
    const leafFill = fig && ((TEXTY.has(n.type) && fig.type === "TEXT") || (MEDIA.has(n.type) && (fig.asset || (fig.fills || []).some((p) => p.type === "IMAGE"))));
    const why = leafFill ? `is the ${TEXTY.has(n.type) ? "text colour" : "picture fill"} of its Figma node, not a background`
      : !fillSupported(n, col) ? "has no visible fill of that colour in Figma (a switched-off fill or a mask shape was copied)"
      : rgbOf(col) === "#D9D9D9" && pictureCovers(n) ? "is Figma's placeholder grey under a picture that covers it" : null;
    if (!why) return;
    log(`${n.id}: background ${col} ${why} - removed`);
    delete n.background;
    if (n.border && !n.border.color && !n.border.width && !n.border.sides && !MEDIA.has(n.type)) delete n.border; // a corner radius with nothing to round (a picture keeps its rounded corners)
    bump("fillsRemoved");
  }

  function recoverMissingAssets(sec, present) {
    const used = [...present].filter((id) => figma[id]);
    const seen = new Set(), missing = [];
    for (const rid of used) {
      const f = figma[rid];
      if (f.type === "TEXT" || f.asset) continue;
      (function dfs(id) {
        const g = figma[id];
        if (!g || seen.has(id) || !g.visible) return;
        if (g.asset) { seen.add(id); if (!present.has(id) && !claimed.has(id) && g.box && g.box.w >= 4 && g.box.h >= 4) missing.push(g); return; }
        for (const c of g.children) dfs(c);
      })(rid);
    }
    for (const a of missing) {
      let host = null, hostArea = Infinity;
      (function walk(n) {
        if (CONTAINER_TYPES.has(n.type)) {
          const b = hasOwnBox(n) ? boxOf(n) : null;
          if (b && inter(a.box, b) >= area(a.box) * 0.95 && b.w * b.h < hostArea) { host = n; hostArea = b.w * b.h; }
        }
        for (const c of n.children || []) walk(c);
      })(sec);
      if (!host) { log(`missing picture ${a.id} "${a.name}" could not be placed: no container holds it`); continue; }
      const el = buildFromFigma(a.id);
      if (!el) continue;
      // an icon beside a line of text belongs in that line (a bullet / check mark), not in the column that stacks the lines
      const vOver = (k) => Math.min(k.y + k.h, a.box.y + a.box.h) - Math.max(k.y, a.box.y);
      const hGap = (k) => Math.max(0, a.box.x - (k.x + k.w), k.x - (a.box.x + a.box.w));
      // a text that carries the id of its Figma GROUP (icon + text) stands for the TEXT inside it only
      const ownBox = (k) => {
        const f = TEXTY.has(k.type) && k.figmaNodeId && figma[k.figmaNodeId];
        if (f && f.type !== "TEXT") { const ts = []; (function dfs(id) { const g = figma[id]; if (!g || !g.visible) return; if (g.type === "TEXT") ts.push(g.box); else g.children.forEach(dfs); })(f.id); if (ts.length) return unionOf(ts); }
        return boxOf(k);
      };
      const adj = host.children.find((k) => { const kb = k.type === "unsupported" ? null : ownBox(k); return kb && vOver(kb) >= a.box.h * 0.5 && hGap(kb) <= 48 && inter(kb, a.box) < area(a.box) * 0.2; });
      if (adj && CONTAINER_TYPES.has(adj.type) && dirOf(adj) === "row") host = adj;
      else if (adj && (TEXTY.has(adj.type) || adj.type === "button")) {
        const line = { type: "row", id: fresh("row"), layout: { display: "flex", direction: "row" }, children: [adj] };
        if (adj.layout?.margin) { line.layout.margin = adj.layout.margin; dropMargin(adj); }
        host.children = host.children.map((k) => (k === adj ? line : k));
        host = line;
      }
      const dir = dirOf(host) || "column";
      let at = host.children.length;
      for (let i = 0; i < host.children.length; i++) {
        const kb = host.children[i].type === "unsupported" ? null : ownBox(host.children[i]);
        if (kb && (dir === "column" ? kb.y > a.box.y + a.box.h / 2 : kb.x > a.box.x + a.box.w / 2)) { at = i; break; }
      }
      host.children.splice(at, 0, el);
      measureFlow(host);
      log(`recovered ${el.type} ${a.id} "${a.name}" into ${host.id} at position ${at}`);
      bump("recoveredAssets");
    }
  }

  // ====================================================================================================
  // K  a picture that lies behind other content is that element's background image
  // ====================================================================================================
  const isSvgAsset = (l) => { const m = manifestById.get(l.asset?.nodeId); return m ? /\.svg$/i.test(m.file) : false; };
  function backdrop(n, sec, chain) {
    const isSec = n.type === "section";
    const kids = rendered(n);
    const nb = isSec ? sectionBand(n).box : hasOwnBox(n) ? boxOf(n) : null;
    if (nb && kids.length >= 1 && !n._bgImage) {
      for (const c of kids) {
        if (!mediaOnly(c)) continue;
        const leaves = mediaLeaves(c);
        if (leaves.length !== 1) continue;
        const pic = leaves[0], pb = boxOf(pic), cb = boxOf(c);
        if (!pb || !cb || area(pb) < area(cb) * 0.9 || pb.w < nb.w * 0.6) continue;
        const on = kids.filter((o) => o !== c && hasText(o) && boxOf(o) && inter(boxOf(o), pb) >= area(boxOf(o)) * 0.6);
        if (!on.length) continue;
        const toSection = chain && pb.w >= pageW * TOL.bleed;
        const host = toSection ? sec : n;
        if (host._bgImage) continue;
        host._bgImage = pic;
        if (isSvgAsset(pic)) host._bgSize = "contain";
        n.children = n.children.filter((o) => o !== c);
        measureFlow(n);
        log(`${n.id}: ${pic.type} ${pic.id} lies behind ${on.length} sibling(s) - it is the background image of ${host === sec ? "the section" : host.id}`);
        bump("backdrops");
        break;
      }
    }
    // a wide graphic buried one level down (beside a dot icon, say) that spans this block and sits behind its text
    if (nb && !isSec && !n._bgImage && kids.length >= 2) {
      const textKids = kids.filter((o) => hasText(o) && boxOf(o));
      for (const c of kids) {
        if (!CONTAINER_TYPES.has(c.type)) continue;
        const wide = (m) => { const f = (x) => (MEDIA.has(x.type) && x.asset && isSvgAsset(x) && boxOf(x) && boxOf(x).w >= nb.w * 0.9) ? x : (x.children || []).map(f).find(Boolean); return f(m); };
        const pic = wide(c);
        const pb = pic && boxOf(pic);
        if (!pb || pb.w < nb.w * 0.9) continue;
        const on = textKids.filter((o) => o !== c && inter(boxOf(o), pb) >= area(boxOf(o)) * 0.6);
        if (!on.length) continue;
        n._bgImage = pic;
        n._bgSize = "contain";
        (function drop(x) { x.children = (x.children || []).filter((o) => o !== pic); for (const k of x.children) drop(k); })(c);
        measureFlow(c);
        log(`${n.id}: ${pic.type} ${pic.id} spans the block behind ${on.length} sibling(s) - it is the background image of ${n.id}`);
        bump("backdrops");
        break;
      }
    }
    const nextChain = chain && !hasVisual(n) && kids.length === 1;
    for (const c of n.children || []) if (CONTAINER_TYPES.has(c.type)) backdrop(c, sec, nextChain || (isSec && kids.length === 1));
  }

  // ====================================================================================================
  // L  a full-width strip (a footer line + copyright) is wider than the site container: it sits beside it in the section
  // ====================================================================================================
  function fullBleedStrips(sec) {
    const kids = rendered(sec);
    if (kids.length < 2) return;
    for (const c of kids) {
      if (!CONTAINER_TYPES.has(c.type) || c.asset || c.abs) continue;
      const b = boxOf(c);
      if (!b || b.w < pageW * TOL.bleed) continue;
      if (!(c.border || c.background)) continue;
      if (!hasText(c)) continue;
      c._fullBleed = true;
      const above = unionOf(kids.filter((o) => o !== c && !(o._fullBleed)).map(boxOf));
      if (above && b.y >= above.y + above.h - 1) c._stripGap = Math.round(b.y - (above.y + above.h)); // the space the section's gap left above the strip
      log(`${c.id}: ${Math.round(b.w)}px wide strip with its own ${c.border ? "border" : "fill"} - placed beside the site container so it spans the screen`);
      bump("fullBleed");
    }
  }

  // ====================================================================================================
  // F  decoration
  // ====================================================================================================
  const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
  const inter = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0; };
  const mediaOnly = (n) => (MEDIA.has(n.type) && !!n.asset) || (CONTAINER_TYPES.has(n.type) && (n.children || []).length > 0 && (n.children || []).every((c) => c.type === "unsupported" || mediaOnly(c)) && (n.children || []).some((c) => c.type !== "unsupported"));
  const mediaLeaves = (n, acc = []) => { if (MEDIA.has(n.type) && n.asset) acc.push(n); else for (const c of n.children || []) mediaLeaves(c, acc); return acc; };
  function place(o, base, ob, bb, z) {
    o.abs = { left: `${r1(((ob.x - bb.x) / bb.w) * 100)}%`, top: `${Math.round(ob.y - bb.y)}px`, width: Math.round(ob.w), z };
    dropMargin(o);
    if (o.layout) { delete o.layout.padding; if (!Object.keys(o.layout).length) delete o.layout; }
  }
  function decoration(n, isSection) {
    for (const c of [...(n.children || [])]) if (CONTAINER_TYPES.has(c.type)) decoration(c, false);
    if (!(CONTAINER_TYPES.has(n.type) || n.type === "section")) return;
    const flow = rendered(n);
    if (flow.length < 2) return;
    const nb = isSection ? null : (hasOwnBox(n) ? boxOf(n) : null);

    // F1: items lying on a sibling picture are layers on it (a crown on a badge, a label on a photo)
    for (const base of flow.filter((c) => MEDIA.has(c.type) && c.asset && boxOf(c))) {
      const bb = boxOf(base);
      const over = flow.filter((o) => o !== base && boxOf(o) && area(boxOf(o)) < area(bb) * 0.8 && inter(boxOf(o), bb) >= area(boxOf(o)) * TOL.inside);
      if (!over.length) continue;
      const rest = flow.filter((o) => o !== base && !over.includes(o));
      if (!rest.length && !isSection) {
        n._relative = true;
        over.forEach((o) => place(o, n, boxOf(o), bb, "1"));
        for (const k of ["gap", "rowGap", "columnGap"]) if (n.layout) delete n.layout[k];
        if (n.layout?.justify) delete n.layout.justify;
        n.children = [base, ...n.children.filter((c) => c !== base)];
      } else {
        const wrap = { type: "column", id: fresh(`${base.id}-stack`), layout: { display: "flex", direction: "column", align: "start" }, _relative: true, children: [base, ...over] };
        if (base.layout?.margin) { wrap.layout.margin = base.layout.margin; dropMargin(base); }
        over.forEach((o) => place(o, wrap, boxOf(o), bb, "1"));
        n.children = n.children.flatMap((c) => (c === base ? [wrap] : over.includes(c) ? [] : [c]));
        measureFlow(n);
      }
      bump("overlays", over.length);
      log(`${n.id}: ${over.length} layer(s) placed on ${base.id} (${over.map((o) => o.id).join(", ")})`);
      return;
    }

    // F2: media-only children that overlap another child, or sit out of order along the main axis, are decoration, not flow
    const dir = dirOf(n) || "column";
    const [mp, ml] = dir === "row" ? ["x", "w"] : ["y", "h"];
    const target = isSection ? sectionBand(n).box : nb;
    if (target) {
      const bs = new Map(flow.map((c) => [c, boxOf(c)]));
      const clash = (c) => flow.some((o) => o !== c && bs.get(o) && bs.get(c) && inter(bs.get(c), bs.get(o)) > 1);
      // decoration touches the edge of what it decorates (a corner vector) or lies over another picture; a photo with a caption on it does neither
      const touches = (b) => Math.abs(b.x - target.x) <= TOL.px || Math.abs(b.x + b.w - (target.x + target.w)) <= TOL.px || Math.abs(b.y - target.y) <= TOL.px || Math.abs(b.y + b.h - (target.y + target.h)) <= TOL.px;
      // a picture hanging out of the left / right edge of what it belongs to cannot be part of the flow
      const pokesOut = (b) => b.x < target.x - 8 || b.x + b.w > target.x + target.w + 8;
      const overMedia = (c) => flow.some((o) => o !== c && bs.get(o) && mediaOnly(o) && inter(bs.get(c), bs.get(o)) > 1);
      const deco = flow.filter((c) => bs.get(c) && mediaOnly(c) && !hasText(c) && ((clash(c) && (touches(bs.get(c)) || overMedia(c))) || pokesOut(bs.get(c))) && area(bs.get(c)) <= 0.25 * area(target));
      const sizeOk = deco.filter((c) => { const b = bs.get(c); return b.w <= pageW * 0.5 && b.h <= 600; });
      if (sizeOk.length && flow.length - sizeOk.length >= 1) {
        for (const c of sizeOk) {
          const cb = bs.get(c);
          const targetEl = isSection ? null : n;
          c.abs = { left: `${r1(((cb.x - target.x) / target.w) * 100)}%`, top: `${Math.round(cb.y - target.y)}px`, width: Math.round(cb.w), z: "0" };
          dropMargin(c);
          if (c.layout) { delete c.layout.padding; if (!Object.keys(c.layout).length) delete c.layout; }
          if (targetEl) targetEl._relative = true;
        }
        if (!isSection) n._relative = true;
        else n._decor = true;
        measureFlow(n);
        bump("decor", sizeOk.length);
        log(`${n.id}: ${sizeOk.length} decoration item(s) overlapping the content positioned absolutely (${sizeOk.map((c) => c.id).join(", ")}); flow measured again`);
        return;
      }
    }

    // F3: a strip of small icons pushed far apart by margins / padding is decoration placed on the parent, not content flowing in it
    if (nb && nb.w >= 300) {
      const strip = flow.filter((c) => mediaOnly(c) && !hasText(c) && c.type !== "button");
      const offsets = (c) => Math.max(c.layout?.margin?.left || 0, c.layout?.margin?.top || 0, padOf(c).right || 0, padOf(c).bottom || 0);
      const small = (c) => { const b = boxOf(c); return b && b.w <= nb.w && b.h <= 160; };
      if (strip.length === flow.length && strip.every(small) && flow.some((c) => offsets(c) >= nb.w * 0.4)) {
        const leaves = flow.flatMap((c) => mediaLeaves(c));
        for (const l of leaves) { const lb = boxOf(l); place(l, n, lb, nb, "0"); }
        n.children = leaves.concat(n.children.filter((c) => c.type === "unsupported"));
        n._relative = true;
        n.size = { ...(n.size || {}), width: n.size?.width ?? "fill", minHeight: Math.round(nb.h) };
        for (const k of ["gap", "rowGap", "columnGap"]) if (n.layout) delete n.layout[k];
        bump("decorStrips");
        log(`${n.id}: strip of ${leaves.length} decoration icons placed absolutely (they were offset by up to ${Math.round(Math.max(...flow.map(offsets)))}px)`);
      }
    }
  }

  // ====================================================================================================
  // D  wrapper removal
  // ====================================================================================================
  function placementEquivalent(parent, wrapper, child) {
    if (!parent) return false;
    const pdir = dirOf(parent);
    if (parent.layout?.display === "grid") return !hasVisual(child);
    if (pdir === "column" || !pdir) {
      if (effAlign(parent) !== "stretch") return true;
      if (effAlign(wrapper) === "stretch") return true;
      const bw = hasOwnBox(wrapper) ? boxOf(wrapper) : null, bc = boxOf(child);
      return !!(bw && bc && Math.abs(bw.w - bc.w) <= TOL.px);
    }
    if (effAlign(parent) === "stretch" && hasVisual(child)) return false;
    return true;
  }
  function canAbsorb(n, W) {
    if (!isPure(W, { size: true })) return false;
    if (W.size && Object.keys(W.size).some((k) => !["width"].includes(k))) return false;
    if (n.layout?.display === "grid" || W.layout?.display === "grid") return false;
    if ((W.children || []).some((k) => k.abs)) return false;
    const nd = dirOf(n) || "column", wd = dirOf(W) || nd;
    const nW = contentWidth(n), wb = boxOf(W);
    const widthEq = nW != null && wb && Math.abs(wb.w - nW) <= TOL.px;
    const nj = n.layout?.justify, wj = W.layout?.justify;
    if (nd === wd) {
      if (nd === "column") return effAlign(n) === effAlign(W) || widthEq || (effAlign(n) === "stretch" && (W.layout?.align ?? "start") === "start");
      return (!nj || nj === "start" || nj === wj) && (widthEq || !wj || wj === "start" || wj === "space-between");
    }
    const wa = W.layout?.align ?? "start";
    if (!(wa === "start" || wa === "stretch")) return false;
    if (nd === "column") return effAlign(n) === "stretch" || widthEq || (effAlign(n) === "start" && wj !== "space-between");
    return !nj || nj === "start";
  }
  function absorb(n, W) {
    const nd = dirOf(n) || "column", wd = dirOf(W) || nd;
    const own = { padding: n.layout?.padding, margin: n.layout?.margin };
    const w = { ...(W.layout || {}) }; delete w.padding; delete w.margin;
    const inheritAlign = w.align === undefined ? n.layout?.align : undefined;
    n.layout = { ...(n.layout || {}), ...w };
    if (inheritAlign !== undefined) n.layout.align = inheritAlign;
    if (nd !== wd) { delete n.layout.rowGap; delete n.layout.columnGap; if (w.gap === undefined) delete n.layout.gap; if (w.justify === undefined) delete n.layout.justify; }
    if (own.padding) n.layout.padding = own.padding; else delete n.layout.padding;
    if (own.margin) n.layout.margin = own.margin; else delete n.layout.margin;
    n.layout.direction = wd;
    if (isNum(W.size?.width) && !n.size?.width && (W.layout?.justify === "space-between" || nd !== wd)) n.size = { ...(n.size || {}), width: r2(W.size.width + padSum(n, "left", "right")) };
    n.notes = mergeNotes(n.notes, W.notes); if (!n.notes) delete n.notes;
    n.children = W.children;
    if (n.type === "row" || n.type === "column") n.type = wd;
    bump("absorbed");
    log(`${n.id}: absorbed single wrapper ${W.id}`);
  }
  function unwrap(n, W) {
    const margin = addSides(n.layout?.margin, W.layout?.margin);
    if (margin) setLayout(W, { margin });
    if (isNum(n.size?.width) && CONTAINER_TYPES.has(W.type) && !hasSize(W)) W.size = { width: n.size.width };
    for (const k of ["maxWidth", "minHeight"]) if (n.size?.[k] !== undefined && W.size?.[k] === undefined && CONTAINER_TYPES.has(W.type)) W.size = { ...(W.size || {}), [k]: n.size[k] };
    const notes = mergeNotes(n.notes, W.notes);
    if (notes) W.notes = notes;
    bump("unwrapped");
    log(`${n.id}: removed pure wrapper around ${W.id}`);
    return W;
  }
  function flattenSameFlow(n) {
    if (!CONTAINER_TYPES.has(n.type) || n.layout?.display === "grid") return;
    const nd = dirOf(n);
    if (!nd) return;
    const out = [];
    for (const c of n.children) {
      const same = isPure(c) && dirOf(c) === nd && c.children?.length && (c.layout?.display || "flex") === (n.layout?.display || "flex")
        && Math.abs(gapOf(c) - gapOf(n)) <= 0.5 && effAlign(c) === effAlign(n) && (c.layout?.justify || "start") === (n.layout?.justify || "start") && c.layout?.justify !== "space-between"
        && !c.children.some((k) => k.abs) && !hasNotes(c);
      if (same) { out.push(...c.children); bump("flattened"); log(`${n.id}: flattened ${c.id} (same flow)`); }
      else out.push(c);
    }
    n.children = out;
  }
  function simplify(n, parent) {
    if (!n.children?.length) return n;
    n.children = n.children.map((c) => simplify(c, n));
    if (n.type === "section" || !CONTAINER_TYPES.has(n.type)) return n;
    flattenSameFlow(n);
    for (let guard = 0; guard < 6; guard++) {
      const rk = rendered(n);
      const extras = (n.children || []).filter((c) => c.type !== "unsupported" && c.abs);
      if (rk.length !== 1 || extras.length) return n;
      const W = rk[0];
      if (isPure(n, { margin: true, size: true }) && placementEquivalent(parent, n, W)) {
        const widthSafe = !isNum(n.size?.width) || CONTAINER_TYPES.has(W.type) || !isNum(W.size?.width) || W.size.width <= n.size.width + 0.5;
        if (widthSafe && !(Object.keys(n.size || {}).some((k) => !["width", "maxWidth", "minHeight"].includes(k)))) return unwrap(n, W);
      }
      if (CONTAINER_TYPES.has(W.type) && W.children?.length && canAbsorb(n, W)) { absorb(n, W); continue; }
      if (on("pills") && canMergeText(n, W)) return mergeText(n, W);
      return n;
    }
    return n;
  }

  // ====================================================================================================
  // P  a frame that only wraps one text and shrink-wraps it (tag, badge, pill, label) is that text with a background, padding and radius
  // ====================================================================================================
  function canMergeText(n, W) {
    if (!["text", "text-basic", "heading"].includes(W.type) || !(n.background || n.border || n.boxShadow)) return false;
    if (n.asset || n._bgImage || n.abs || n._grid || n.layout?.display === "grid" || n.href || n.link) return false;
    if (n.size && Object.keys(n.size).some((k) => k !== "width" && k !== "maxWidth")) return false;
    if (W.layout?.margin && Object.values(W.layout.margin).some((v) => Math.abs(v) > 0.5)) return false;
    const nb = hasOwnBox(n) ? boxOf(n) : null, tb = boxOf(W);
    if (!nb || !tb) return false;
    const bw = n.border?.width || 0, p = padOf(n);
    const slackX = nb.w - (p.left || 0) - (p.right || 0) - 2 * bw - tb.w, slackY = nb.h - (p.top || 0) - (p.bottom || 0) - 2 * bw - tb.h;
    return Math.abs(slackX) <= 2 && Math.abs(slackY) <= 2; // the text really fills the frame (no centring/stretching inside a wider box)
  }
  function mergeText(n, W) {
    const t = { ...W };
    for (const k of ["background", "border", "boxShadow", "_sepLead"]) if (n[k] !== undefined) t[k] = n[k];
    const lay = { ...(W.layout || {}) };
    if (n.layout?.padding) lay.padding = n.layout.padding;
    if (n.layout?.margin) lay.margin = n.layout.margin;
    t.layout = lay;
    if (!Object.keys(lay).length) delete t.layout;
    if (n.size?.width !== undefined) t.size = { ...(W.size || {}), width: n.size.width };
    log(`${n.id}: shrink-wrapped frame merged into its text ${W.id} (background/padding/radius now on the text)`);
    bump("pills");
    return t;
  }

  // ====================================================================================================
  // G  grids
  // ====================================================================================================
  const isCard = (c) => CONTAINER_TYPES.has(c.type) && (c.children || []).length > 0;
  function detectGrid(cards) {
    if (cards.length < 2) return null;
    const boxes = cards.map(boxOf);
    if (boxes.some((b) => !b)) return null;
    const order = cards.map((_, i) => i).sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
    const rows = [];
    for (const i of order) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(boxes[i].y - last.y) <= TOL.rowY) last.idx.push(i);
      else rows.push({ y: boxes[i].y, idx: [i] });
    }
    for (const r of rows) r.idx.sort((a, b) => boxes[a].x - boxes[b].x);
    const cols = rows[0].idx.length;
    if (cols < 2) return null;
    if (rows.slice(0, -1).some((r) => r.idx.length !== cols) || rows[rows.length - 1].idx.length > cols) return null;
    if (rows.flatMap((r) => r.idx).some((v, i) => v !== i)) return null; // document order must already be reading order
    const ws = boxes.map((b) => b.w);
    if (Math.max(...ws) - Math.min(...ws) > Math.max(TOL.px, Math.max(...ws) * TOL.sizePct)) return null;
    for (const r of rows) { const hs = r.idx.map((i) => boxes[i].h); if (Math.max(...hs) - Math.min(...hs) > Math.max(TOL.px, Math.max(...hs) * 0.03)) return null; }
    const xs0 = rows[0].idx.map((i) => boxes[i].x);
    for (const r of rows) for (let j = 0; j < r.idx.length; j++) if (Math.abs(boxes[r.idx[j]].x - xs0[j]) > TOL.px + 1) return null;
    const cg = [];
    for (let j = 1; j < cols; j++) cg.push(xs0[j] - (xs0[j - 1] + boxes[rows[0].idx[j - 1]].w));
    if (cg.some((g) => g < -0.5) || Math.max(...cg) - Math.min(...cg) > TOL.gapPx) return null;
    const colGap = cg.reduce((a, b) => a + b, 0) / cg.length;
    let rowGap = null;
    if (rows.length > 1) {
      const rg = [];
      for (let r = 1; r < rows.length; r++) rg.push(boxes[rows[r].idx[0]].y - Math.max(...rows[r - 1].idx.map((i) => boxes[i].y + boxes[i].h)));
      if (rg.some((g) => g < -0.5) || Math.max(...rg) - Math.min(...rg) > TOL.gapPx) return null;
      rowGap = rg.reduce((a, b) => a + b, 0) / rg.length;
    }
    return { cols, rows: rows.length, colGap: r2(colGap), rowGap: rowGap == null ? null : r2(rowGap) };
  }
  function makeGrid(n, info) {
    const keep = { padding: n.layout?.padding, margin: n.layout?.margin };
    n.layout = { display: "grid", gridColumns: info.cols, align: "stretch" };
    if (info.rowGap != null && Math.abs(info.rowGap - info.colGap) > TOL.gapPx) { n.layout.gridGap = info.colGap; n.layout.gridRowGap = info.rowGap; }
    else n.layout.gridGap = info.rowGap != null ? r2((info.colGap + info.rowGap) / 2) : info.colGap;
    if (keep.padding) n.layout.padding = keep.padding;
    if (keep.margin) n.layout.margin = keep.margin;
    if (n.type === "row" || n.type === "column") n.type = "block";
    for (const c of n.children) dropMargin(c);
    n._grid = true;
  }
  const isCardRow = (c) => (c.type === "row" || dirOf(c) === "row") && !c.background && !c.border && !hasPad(c) && rendered(c).length >= 2 && rendered(c).every(isCard);
  function mergeGrids(n) {
    for (const c of n.children || []) mergeGrids(c);
    if (!CONTAINER_TYPES.has(n.type) && n.type !== "section") return;
    const kids = n.children || [];
    const out = [];
    for (let i = 0; i < kids.length; i++) {
      if (!isCardRow(kids[i])) { out.push(kids[i]); continue; }
      let j = i + 1;
      while (j < kids.length && isCardRow(kids[j]) && rendered(kids[j]).length === rendered(kids[i]).length) j++;
      if (j - i >= 2) {
        const run = kids.slice(i, j);
        const cards = run.flatMap((r) => rendered(r));
        const info = detectGrid(cards);
        if (info && info.rows >= 2) {
          const merged = run[0];
          merged.children = cards;
          makeGrid(merged, info);
          merged.notes = mergeNotes(...run.map((r) => r.notes)); if (!merged.notes) delete merged.notes;
          out.push(merged);
          bump("mergedRows", run.length - 1);
          log(`${n.id}: ${run.length} rows of cards merged into one ${info.cols}-column grid (${cards.length} cards)`);
          i = j - 1;
          continue;
        }
      }
      out.push(kids[i]);
    }
    n.children = out;
    if (n.type !== "section" && !n._grid) {
      const flow = rendered(n);
      if (flow.length >= 4 && flow.every(isCard) && flow.length === n.children.filter((c) => c.type !== "unsupported").length) {
        const info = detectGrid(flow);
        if (info && info.rows >= 2) { makeGrid(n, info); bump("grids"); log(`${n.id}: ${flow.length} cards form a ${info.cols} x ${info.rows} grid (measured from Figma)`); }
      }
      // one row of 2-6 equal cards inside a padded / filled panel (a PROS column and a CONS column) is a grid as well; plain rows stay rows (responsive-pass decides)
      const row = rendered(n);
      if (!n._grid && dirOf(n) === "row" && (n.background || n.border || hasPad(n)) && row.length >= 2 && row.length <= 6 && row.every(isCard) && row.length === n.children.filter((c) => c.type !== "unsupported").length) {
        const info = detectGrid(row);
        if (info && info.rows === 1) { makeGrid(n, info); bump("grids"); log(`${n.id}: one row of ${row.length} equal cards -> ${info.cols}-column grid, gap ${info.colGap} (measured from Figma)`); }
      }
    }
  }

  // ====================================================================================================
  // S  spanning children say "fill"
  // ====================================================================================================
  function spanning(n) {
    for (const c of n.children || []) spanning(c);
    if (!CONTAINER_TYPES.has(n.type) || n.layout?.display === "grid") return;
    if (dirOf(n) === "row" || effAlign(n) === "stretch") return;
    if (!hasOwnBox(n)) {
      // no Figma box for this wrapper (the model made it up): a stack of 2+ cards of one width is a stack of full-width cards
      const cards = rendered(n).filter(isCard), bs = cards.map(boxOf);
      if (cards.length >= 2 && bs.every(Boolean)) { // (a heading above the cards does not matter)
        const w = Math.max(...bs.map((b) => b.w));
        if (bs.every((b) => b.w >= w * TOL.span)) for (const c of cards) if (!isNum(c.size?.width) && c.size?.width !== "fill") { c.size = { ...(c.size || {}), width: "fill" }; bump("spanning"); }
      }
      return;
    }
    const cw = contentWidth(n);
    if (!cw) return;
    for (const c of rendered(n)) {
      if (!isCard(c) || isNum(c.size?.width) || c.size?.width === "fill") continue;
      const b = boxOf(c);
      if (b && b.w >= cw * TOL.span && b.w <= cw * 1.02 + 2) { c.size = { ...(c.size || {}), width: "fill" }; bump("spanning"); }
    }
  }

  // ====================================================================================================
  // R  roles
  // ====================================================================================================
  const sig = (n) => (CONTAINER_TYPES.has(n.type) ? `${n.type === "block" ? "column" : n.type}(${rendered(n).map(sig).join(",")})` : (TEXTY.has(n.type) ? "T" : n.type));
  const leavesOf = (n, acc = []) => { for (const c of rendered(n)) { if (CONTAINER_TYPES.has(c.type)) leavesOf(c, acc); else acc.push(c); } return acc; };
  function roles(n) {
    for (const c of n.children || []) roles(c);
    const kids = rendered(n).filter(isCard);
    if (kids.length >= 2) {
      const groups = new Map();
      for (const k of kids) { const s = sig(k); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(k); }
      for (const [, g] of groups) {
        if (g.length < 2) continue;
        const ls = g.map((k) => leavesOf(k));
        for (let p = 0; p < ls[0].length; p++) {
          const col = ls.map((l) => l[p]);
          const heads = col.filter((x) => x.type === "heading");
          if (!heads.length || heads.length === col.length) continue;
          const ref = heads[0];
          for (const x of col) {
            if (x.type === "heading" || !TEXTY.has(x.type)) continue;
            const a = x.typography || {}, b = ref.typography || {};
            if (a.fontSize === b.fontSize && Number(a.fontWeight) === Number(b.fontWeight)) { x.type = "heading"; x.level = ref.level || 3; bump("headings"); log(`${x.id}: "${String(x.text).slice(0, 30)}" is a heading like its siblings in the repeated card`); }
          }
        }
      }
    }
    if (CONTAINER_TYPES.has(n.type)) {
      const flow = rendered(n);
      const texts = flow.filter((c) => TEXTY.has(c.type));
      const first = texts[0], next = texts[1];
      if (first && next && (first.type === "text" || first.type === "text-basic") && flow.indexOf(first) === 0 && !flow.some((x) => x.type === "heading")) {
        const a = first.typography || {}, b = next.typography || {};
        const short = typeof first.text === "string" && first.text.length <= 80 && !/\n/.test(first.text);
        if (short && Number(a.fontWeight) >= 600 && a.fontSize >= 16 && (Number(a.fontWeight) > Number(b.fontWeight) || a.fontSize > b.fontSize)) {
          first.type = "heading"; first.level = first.level || 3; bump("headings");
          log(`${first.id}: "${first.text.slice(0, 30)}" is the bold title above its copy -> heading`);
        }
      }
    }
  }

  // ====================================================================================================
  // Z  sanity: spacing wider than the parent is positioning
  // ====================================================================================================
  // A  a column whose children are centred on one axis (but start at different x) is align:center, whatever the model wrote
  function alignCentre(n) {
    for (const c of n.children || []) alignCentre(c);
    if (!CONTAINER_TYPES.has(n.type) || n.layout?.display === "grid" || dirOf(n) !== "column") return;
    if (n.layout?.align && n.layout.align !== "start") return;
    const flow = rendered(n);
    if (!flow.length) return;
    const boxes = flow.map(boxOf);
    if (boxes.some((b) => !b)) return;
    const cs = boxes.map((b) => b.x + b.w / 2), ss = boxes.map((b) => b.x);
    const lo = Math.min(...ss), hi = Math.max(...boxes.map((b) => b.x + b.w)), tol = Math.max(6, 0.01 * (hi - lo));
    if (!cs.every((c) => Math.abs(c - cs[0]) <= tol)) return;
    if (ss.every((x) => Math.abs(x - lo) <= tol)) return; // already one left edge: start is right
    if (flow.length === 1 && !(hasOwnBox(n) && Math.abs(boxes[0].x + boxes[0].w / 2 - (boxOf(n).x + boxOf(n).w / 2)) <= tol)) return;
    setLayout(n, { align: "center" }); bump("alignCentre");
  }
  // ====================================================================================================
  // A2  the Figma auto-layout cross-axis setting (MIN / CENTER / MAX) decides the alignment when the children fit it. Geometry alone cannot tell
  //     start from centre for one child, or for children as wide as the box, so the model's / the measured "start" is replaced by what the
  //     designer set.
  // ====================================================================================================
  function figmaAlign(n) {
    for (const c of n.children || []) figmaAlign(c);
    if (!CONTAINER_TYPES.has(n.type) || n.type === "section" || n.layout?.display === "grid" || !hasOwnBox(n)) return;
    const f = figma[n.figmaNodeId];
    const fa = { MIN: "start", CENTER: "center", MAX: "end" }[f?.counterAxisAlignItems];
    if (!fa || !f.layoutMode || f.layoutMode === "NONE") return;
    const figDir = f.layoutMode === "HORIZONTAL" ? "row" : "column";
    if (dirOf(n) !== figDir || (n.layout?.align || "start") === fa) return;
    const flow = rendered(n);
    if (!flow.length) return;
    const boxes = flow.map(boxOf), nb = boxOf(n);
    if (boxes.some((b) => !b) || !nb) return;
    const col = figDir === "column";
    const lo = col ? nb.x : nb.y, hi = col ? nb.x + nb.w : nb.y + nb.h, tol = Math.max(6, 0.01 * (hi - lo));
    const pos = (b) => (col ? b.x : b.y), len = (b) => (col ? b.w : b.h);
    const fits = fa === "start" ? boxes.every((b) => pos(b) - lo <= tol + (n.layout?.padding?.[col ? "left" : "top"] || 0))
      : fa === "center" ? boxes.every((b) => Math.abs(pos(b) + len(b) / 2 - (lo + hi) / 2) <= tol)
      : boxes.every((b) => hi - (pos(b) + len(b)) <= tol + (n.layout?.padding?.[col ? "right" : "bottom"] || 0));
    if (!fits) return;
    setLayout(n, { align: fa }); bump("figmaAlign");
    log(`${n.id}: align ${fa} from the Figma auto-layout setting`);
  }
  // ====================================================================================================
  // A4  gap and padding of a frame come from its Figma auto-layout (item spacing / padding) - only where the rendered boxes agree
  // ====================================================================================================
  function figmaSpacing(n) {
    for (const c of n.children || []) figmaSpacing(c);
    if (!CONTAINER_TYPES.has(n.type) || n.type === "section" || n.layout?.display === "grid" || !hasOwnBox(n)) return;
    const f = figma[n.figmaNodeId];
    if (!f?.layoutMode || f.layoutMode === "NONE" || f.layoutWrap === "WRAP") return;
    const dir = f.layoutMode === "HORIZONTAL" ? "row" : "column";
    if (dirOf(n) !== dir) return;
    const flow = rendered(n);
    const nb = boxOf(n);
    if (!flow.length || !nb) return;
    const boxes = flow.map(boxOf);
    if (boxes.some((b) => !b)) return;
    const [mp, ml] = dir === "row" ? ["x", "w"] : ["y", "h"];
    // gap
    const sp = f.itemSpacing;
    if (flow.length > 1 && sp > 0 && n.layout?.justify !== "space-between" && f.primaryAxisAlignItems !== "SPACE_BETWEEN") {
      const gaps = [];
      for (let i = 1; i < flow.length; i++) gaps.push(boxes[i][mp] - (flow[i]._sepLead || 0) - (boxes[i - 1][mp] + boxes[i - 1][ml]));
      const cur = n.layout?.columnGap ?? n.layout?.gap ?? 0;
      if (gaps.every((g) => Math.abs(g - sp) <= 1.5) && Math.abs(cur - sp) > 1) {
        setLayout(n, { gap: sp, columnGap: undefined, rowGap: undefined }); bump("figmaGap");
        log(`${n.id}: gap ${r2(cur)} -> ${sp} from the Figma item spacing`);
      }
    }
    // padding: the Figma value stands where the first/last child really sits that far from the frame edge
    const u = unionOf(boxes);
    const edge = { left: u.x - nb.x, top: u.y - nb.y, right: nb.x + nb.w - (u.x + u.w), bottom: nb.y + nb.h - (u.y + u.h) };
    const startSides = dir === "row" ? ["left"] : ["top"];
    for (const side of startSides) {
      const want = f.pad?.[side];
      const cur = n.layout?.padding?.[side] || 0;
      if (want > 0 && Math.abs(cur - want) > 1 && Math.abs(edge[side] - want) <= 1.5) {
        setLayout(n, { padding: { ...(n.layout?.padding || {}), [side]: want } }); bump("figmaPadding");
        log(`${n.id}: padding-${side} ${r2(cur)} -> ${want} from the Figma padding`);
      }
    }
  }
  // ====================================================================================================
  // A3  a drop shadow set on the Figma frame is the element's box-shadow (the model rarely carries it over)
  // ====================================================================================================
  function shadows(n) {
    for (const c of n.children || []) shadows(c);
    if (!CONTAINER_TYPES.has(n.type) || n.type === "section" || n.boxShadow || !hasOwnBox(n)) return;
    const f = figma[n.figmaNodeId];
    const e = (f?.effects || []).find((x) => x.type === "DROP_SHADOW" && x.visible !== false && x.color);
    if (!e || !(f.fills || []).some((p) => p.visible !== false) && !n.background) return; // a shadow with no fill under it would not show as a box shadow
    const color = solidHex({ type: "SOLID", color: e.color, opacity: 1 });
    if (!color) return;
    n.boxShadow = { color, blur: Math.round(e.radius || 0), offsetX: Math.round(e.offset?.x || 0), offsetY: Math.round(e.offset?.y || 0), spread: Math.round(e.spread || 0) };
    bump("shadows");
    log(`${n.id}: box-shadow from the Figma drop shadow`);
  }
  const TEXT_LEAF = new Set(["heading", "text", "text-basic"]);
  function sanity(n, parent) {
    for (const c of n.children || []) sanity(c, n);
    // a text leaf has no flex children: "justify" on it can only mean text alignment
    if (TEXT_LEAF.has(n.type) && n.layout?.justify && n.layout.justify !== "start" && !n.typography?.align) {
      const al = { center: "center", end: "right" }[n.layout.justify];
      if (al) { n.typography = { ...(n.typography || {}), align: al }; delete n.layout.justify; bump("textAlign"); }
    }
    if (TEXT_LEAF.has(n.type) && n.layout && (n.layout.display === "flex" || n.layout.justify === "start")) {
      delete n.layout.justify; delete n.layout.direction; if (n.layout.display === "flex") delete n.layout.display; // a text has no flex children
      if (!Object.keys(n.layout).length) delete n.layout;
    }
    // padding that cannot fit: content + padding would be wider/taller than the element's own Figma box (the model counted space
    // occupied by something it then dropped); the padding is what is really left between the content and the edge
    if (CONTAINER_TYPES.has(n.type) && n.type !== "section" && n.layout?.padding && hasOwnBox(n)) {
      const ob = boxOf(n), fl = rendered(n).map(boxOf);
      if (ob && fl.length && fl.every(Boolean)) {
        const u = unionOf(fl), pad = n.layout.padding;
        const real = { left: u.x - ob.x, top: u.y - ob.y, right: ob.x + ob.w - (u.x + u.w), bottom: ob.y + ob.h - (u.y + u.h) };
        for (const sd of ["left", "right", "top", "bottom"]) {
          if ((pad[sd] || 0) > Math.max(0, real[sd]) + 24) {
            log(`${n.id}: padding-${sd} ${pad[sd]}px does not fit inside its box (only ${Math.round(Math.max(0, real[sd]))}px free) - corrected`);
            pad[sd] = Math.max(0, Math.round(real[sd])); bump("paddingFit");
          }
        }
      }
    }
    if (n.type === "section" || n.abs) return;
    const pb = parent && parent.type !== "section" && hasOwnBox(parent) ? boxOf(parent) : null;
    const limit = pb ? pb.w : pageW;
    for (const [kind, o] of [["margin", n.layout?.margin], ["padding", n.layout?.padding]]) {
      if (!o) continue;
      for (const s of ["left", "right"]) {
        if (Math.abs(o[s] || 0) > limit * 0.6 && Math.abs(o[s]) > 400) {
          log(`${n.id}: ${kind}-${s} ${o[s]}px is wider than its parent (${Math.round(limit)}px): positioning, not spacing - removed`);
          bump("clamped");
          delete o[s];
        }
      }
      if (!Object.keys(o).length) { delete n.layout[kind]; if (!Object.keys(n.layout).length) delete n.layout; }
    }
  }

  // ---------------- run ----------------
  const sections = (doc.children || []).filter((c) => c.type === "section");
  for (const sec of sections) {
    if (on("hoist")) hoist(sec);
    if (on("dividers")) { dividersToBorders(sec); separatorsToBorders(sec); }
    if (on("rebuild")) rebuildUnsupported(sec);
    if (on("fills")) reconcileFills(sec);
    const covered = on("missingText") || on("assets") ? coverage(sec) : null;
    if (on("missingText")) recoverMissingText(sec, covered);
    if (on("assets")) recoverMissingAssets(sec, coverage(sec));
    if (on("backdrop")) backdrop(sec, sec, true);
    if (on("decoration")) decoration(sec, true);
    if (on("wrappers")) sec.children = (sec.children || []).map((c) => simplify(c, sec));
    if (on("grids")) mergeGrids(sec);
    if (on("wrappers")) sec.children = (sec.children || []).map((c) => simplify(c, sec));
    if (on("spanning")) spanning(sec);
    if (on("align")) { alignCentre(sec); figmaAlign(sec); figmaSpacing(sec); }
    if (on("shadows")) shadows(sec);
    if (on("roles")) roles(sec);
    if (on("sanity")) sanity(sec, null);
    if (on("fullBleed")) fullBleedStrips(sec);
  }
  return { doc, report, stats };
}