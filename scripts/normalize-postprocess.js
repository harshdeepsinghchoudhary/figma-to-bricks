/**
 * Stage 2 post-processing: the model decides STRUCTURE (which element is a heading/button/image,
 * how things are grouped). Everything that can be MEASURED or COPIED from the Figma data is
 * set here by code, so a new design doesn't depend on the model doing arithmetic correctly.
 *
 *   sanitize(doc, schema)            fixes misplaced fields BEFORE schema validation
 *   finalize(doc, geoTree, opts)     overwrites text, typography, sizes, gaps, margins, padding,
 *                                    alignment, button styling and heading levels from Figma
 *
 * geoTree is the compact Figma tree built by 2_normalize.js (nodes have id, box [x,y,w,h],
 * characters, style, fills, children; loose siblings are wrapped in {g:"row"|"column"} groups).
 */

const r2 = (n) => Math.round(n * 100) / 100;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// ----------------------------------------------------------------------------------------------
// sanitize
// ----------------------------------------------------------------------------------------------
const SUBS = ["layout", "size", "background", "border", "boxShadow", "typography"];

export function sanitize(doc, schema) {
  const defs = schema.definitions || {};
  const keysOf = (name) => new Set(Object.keys(defs[name]?.properties || {}));
  const nodeKeys = keysOf("node");
  const subKeys = Object.fromEntries(SUBS.map((s) => [s, keysOf(s)]));
  const fixes = [];
  const dropped = [];

  const place = (node, key, value, from) => {
    // Where should a stray key live? Prefer the node itself, then whichever sub-object defines it.
    if (key === "notes" && Array.isArray(value)) { // notes misplaced inside another object: keep them, merge into the element's notes
      node.notes = [...(Array.isArray(node.notes) ? node.notes : []), ...value.filter((x) => typeof x === "string")];
      fixes.push(`${node.id}: merged misplaced "notes" from ${from} into the element's notes`);
      return true;
    }
    if (nodeKeys.has(key) && node[key] === undefined) { node[key] = value; fixes.push(`${node.id}: moved "${key}" out of ${from} onto the element`); return true; }
    for (const s of SUBS) {
      if (s !== from && subKeys[s].has(key)) {
        node[s] = isObj(node[s]) ? node[s] : {};
        if (node[s][key] === undefined) { node[s][key] = value; fixes.push(`${node.id}: moved "${key}" from ${from} to ${s}`); return true; }
      }
    }
    return false;
  };

  (function walk(node) {
    if (!isObj(node)) return;
    for (const k of Object.keys(node)) {
      if (nodeKeys.has(k)) continue;
      const v = node[k];
      delete node[k];
      if (!place(node, k, v, "element")) { dropped.push(`${node.id}: dropped unknown field "${k}"`); }
    }
    for (const s of SUBS) {
      if (!isObj(node[s])) continue;
      for (const k of Object.keys(node[s])) {
        if (subKeys[s].has(k)) continue;
        const v = node[s][k];
        delete node[s][k];
        if (!place(node, k, v, s)) dropped.push(`${node.id}: dropped unknown field "${s}.${k}"`);
      }
      if (!Object.keys(node[s]).length) delete node[s];
    }
    for (const c of node.children || []) walk(c);
  })({ children: doc.children || [] });

  return { fixes, dropped };
}

// ----------------------------------------------------------------------------------------------
// geometry helpers
// ----------------------------------------------------------------------------------------------
function indexGeo(root) {
  const byId = new Map();
  (function walk(n) {
    if (!isObj(n)) return;
    if (n.id && !byId.has(n.id)) byId.set(n.id, n);
    for (const c of n.children || []) walk(c);
  })(root);
  return byId;
}
const boxRect = (b) => (Array.isArray(b) && b.length === 4 ? { x: b[0], y: b[1], w: b[2], h: b[3] } : null);
const union = (rects) => {
  const rs = rects.filter(Boolean);
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const descendants = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); descendants(c, acc); } return acc; };
const firstText = (n) => (n.type === "TEXT" ? n : descendants(n).find((d) => d.type === "TEXT"));
const alignOf = (v) => ({ LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" })[v];

// ----------------------------------------------------------------------------------------------
// finalize
// ----------------------------------------------------------------------------------------------
const CONTAINERS = new Set(["section", "container", "row", "column", "block"]);
const TEXTY = new Set(["heading", "text", "text-basic"]);

export function finalize(doc, geoTree, opts = {}) {
  const { gradients = [], isHero = false } = opts;
  const geo = indexGeo(geoTree);
  const log = [];
  const set = (what) => log.push(what);
  const geoOf = (n) => (n.figmaNodeId && n.figmaNodeId !== "scope" ? geo.get(n.figmaNodeId) : null);

  // ---- own-or-descendant box of an output node ----
  const rectOf = (n) => {
    const g = geoOf(n);
    const wrongKind = g && CONTAINERS.has(n.type) && (g.type === "TEXT" || g.asset); // model reused a leaf's id on a wrapper
    const own = g && !wrongKind ? boxRect(g.box) : null;
    if (own) return own;
    if (n.asset?.nodeId && geo.get(n.asset.nodeId)) return boxRect(geo.get(n.asset.nodeId).box);
    // a skipped divider (e.g. a full-height vertical line) must not stretch the box of the group around it
    const kids = n.children || [];
    const shown = kids.filter((c) => c.type !== "unsupported");
    return union((shown.length ? shown : kids).map(rectOf));
  };

  // ---- text, typography, button styling, sizes (leaf elements) ----
  const leafPass = (n, parent) => {
    const g = geoOf(n);
    // Text, icons and images are leaves: Figma gives them no padding, and the gap to their neighbour is measured on the parent. Padding the
    // model put on one (a 10px "left padding" on bullet text, 6px on a check icon) stacks on top of that gap and pushes the layout out of line.
    // Only margin (the measured offset) survives, and text has no children to align, so align is dropped there too.
    if ((TEXTY.has(n.type) || n.type === "image" || n.type === "icon") && isObj(n.layout)) {
      const dropped = [];
      if (n.layout.padding) { delete n.layout.padding; dropped.push("padding"); }
      if (TEXTY.has(n.type) && n.layout.align) { delete n.layout.align; dropped.push("align"); }
      if (dropped.length) set(`${n.id}: removed model-invented ${dropped.join(" + ")} from a ${n.type} leaf`);
      if (!Object.keys(n.layout).length) delete n.layout;
    }
    if (TEXTY.has(n.type) || n.type === "button") {
      const t = g ? firstText(g) : null;
      if (t) {
        // Figma text often carries non-breaking spaces (pasted copy); they stop the browser from wrapping there, and a hand-built page uses plain spaces.
        if (typeof t.characters === "string") n.text = t.characters.replace(/\u00a0/g, " ");
        const ty = (n.typography = isObj(n.typography) ? n.typography : {});
        const st = t.style || {};
        for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight"]) if (st[k] !== undefined) ty[k] = st[k];
        const tt = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" }[st.textCase];
        if (tt) ty.textTransform = tt; else delete ty.textTransform;
        const al = alignOf(st.textAlignHorizontal);
        if (al) ty.align = al;
        const fill = (t.fills || [])[0];
        if (fill?.t === "SOLID" && fill.c) { ty.color = fill.c; delete ty.colorGradient; }
        else if (fill?.t === "GRADIENT_LINEAR") {
          const gr = gradients.find((x) => x.nodeId === t.id && x.appliesTo === "text");
          if (gr) { ty.colorGradient = gr.gradient; delete ty.color; }
        }
        set(`${n.id}: text + typography from Figma`);
        // big bold short text is a heading whatever the model called it (a title that came back as a paragraph loses its H tag)
        if ((n.type === "text" || n.type === "text-basic") && ty.fontSize >= 22 && Number(ty.fontWeight) >= 600 && typeof n.text === "string" && n.text.length <= 100 && !/\n/.test(n.text)) {
          n.type = "heading"; n.level = n.level || 2;
          set(`${n.id}: ${ty.fontSize}px/${ty.fontWeight} text -> heading`);
        }
      }
    }
    if (n.type === "button" && g) {
      const all = [g, ...descendants(g)];
      const gr = gradients.find((x) => x.appliesTo === "background" && all.some((d) => d.id === x.nodeId));
      if (gr) { n.background = { gradient: gr.gradient }; set(`${n.id}: gradient background from Figma`); }
      else {
        const solid = all.map((d) => (d.fills || []).find((f) => f.t === "SOLID" && d.type !== "TEXT")).find(Boolean);
        if (solid?.c) n.background = { color: solid.c };
      }
      const rad = all.map((d) => d.cornerRadius).find((v) => typeof v === "number");
      if (rad !== undefined) n.border = { ...(n.border || {}), radius: rad };
      const icons = all.filter((d) => d.asset);
      for (const ic of icons) {
        const b = boxRect(ic.box);
        const note = `Figma has an icon asset (${ic.id}${b ? `, ${r2(b.w)}x${r2(b.h)}` : ""}) inside this button; the schema cannot place an icon inside a button yet.`;
        n.notes = n.notes || [];
        if (!n.notes.some((x) => x.includes(ic.id))) n.notes.push(note);
      }
      const r = rectOf(n);
      if (r) { n.size = { ...(n.size || {}), width: r2(r.w) }; delete n.size.height; }
      // padding = how far the label sits inside the button's own box (the model only guessed it, and left it out on some cards)
      const lt = firstText(g), tb = lt && g.type !== "TEXT" ? boxRect(lt.box) : null, gb = boxRect(g.box);
      if (tb && gb) {
        const pd = { top: Math.max(0, r2(tb.y - gb.y)), right: Math.max(0, r2(gb.x + gb.w - (tb.x + tb.w))), bottom: Math.max(0, r2(gb.y + gb.h - (tb.y + tb.h))), left: Math.max(0, r2(tb.x - gb.x)) };
        n.layout = isObj(n.layout) ? n.layout : {};
        n.layout.padding = pd;
        // a button as wide as its parent says "fill" instead of repeating its horizontal padding
        const pr = parent && parent.type !== "section" ? rectOf(parent) : null;
        if (pr && gb.w >= pr.w * 0.97) { n.layout.padding = { top: pd.top, bottom: pd.bottom }; n.size = { ...(n.size || {}), width: "fill" }; }
        set(`${n.id}: button padding from box`);
      }
    }
    if (n.type === "image" || n.type === "icon") {
      const b = n.asset?.nodeId && geo.get(n.asset.nodeId) ? boxRect(geo.get(n.asset.nodeId).box) : rectOf(n);
      if (b) { n.size = { ...(n.size || {}), width: r2(b.w), height: r2(b.h) }; set(`${n.id}: size from asset box`); }
    }
    if (TEXTY.has(n.type)) {
      n.size = isObj(n.size) ? n.size : {};
      delete n.size.height;
      const t = g ? firstText(g) : null;
      const b = t ? boxRect(t.box) : null;
      if (b && t.layoutSizingHorizontal !== "HUG") n.size.width = r2(b.w);
      else delete n.size.width;
    }
    for (const c of n.children || []) leafPass(c, n);
    if (n.size && !Object.keys(n.size).length) delete n.size;
  };

  // ---- containers: direction, gap, margins, alignment, padding ----
  const layoutPass = (n, parent) => {
    for (const c of n.children || []) layoutPass(c, n);
    if (!CONTAINERS.has(n.type) || !n.children?.length) return;
    if (n.type === "block" && n.layout?.display !== "flex") return;

    // Dividers the compiler skips ("unsupported" lines) take no part in the layout. A full-height divider between two columns would
    // otherwise zero the card's vertical padding and turn the gaps either side of it into a 54px flex gap.
    const flow = n.children.filter((c) => c.type !== "unsupported");
    if (!flow.length) return;
    const rects = flow.map(rectOf);
    if (rects.some((r) => !r)) { set(`${n.id}: skipped layout (a child has no Figma box)`); return; } // leave the model's values alone
    const dir = n.type === "row" ? "row" : n.type === "column" ? "column" : n.layout?.direction || "column";
    const [mainPos, mainLen, crossPos, crossLen] = dir === "row" ? ["x", "w", "y", "h"] : ["y", "h", "x", "w"];
    const [leadM, trailM, crossLead] = dir === "row" ? ["left", "right", "top"] : ["top", "bottom", "left"];

    // children must run in order along the main axis without overlapping, otherwise it's not a flow layout
    for (let i = 1; i < flow.length; i++) {
      if (rects[i][mainPos] < rects[i - 1][mainPos] + rects[i - 1][mainLen] - 0.5) { set(`${n.id}: skipped layout (children overlap or are out of order along the ${dir} axis - check the nesting)`); return; }
    }

    n.layout = isObj(n.layout) ? n.layout : {};
    n.layout.display = "flex";
    n.layout.direction = dir;
    const clearMargin = (c, sides) => {
      if (!isObj(c.layout?.margin)) return;
      for (const s of sides) delete c.layout.margin[s];
      if (!Object.keys(c.layout.margin).length) delete c.layout.margin;
      if (!Object.keys(c.layout).length) delete c.layout;
    };
    const addMargin = (c, side, v) => {
      c.layout = isObj(c.layout) ? c.layout : {};
      c.layout.margin = { ...(c.layout.margin || {}), [side]: r2(v) };
    };

    // main axis: equal gaps -> gap, otherwise margins
    flow.forEach((c) => clearMargin(c, [leadM, trailM]));
    const gaps = [];
    for (let i = 1; i < flow.length; i++) gaps.push(Math.max(0, rects[i][mainPos] - (rects[i - 1][mainPos] + rects[i - 1][mainLen])));
    delete n.layout.gap; delete n.layout.rowGap; delete n.layout.columnGap;
    // Items pushed to opposite ends of a row are "space-between", not a fixed px gap (a 294px gap overflows on small screens).
    const figSB = dir === "row" && flow.length > 1 && geoOf(n)?.layoutMode === "HORIZONTAL" && geoOf(n)?.primaryAxisAlignItems === "SPACE_BETWEEN";
    const wideEven = dir === "row" && flow.length > 1 && gaps.length > 0 && gaps.every((g) => Math.abs(g - gaps[0]) <= 1) && gaps[0] >= 120 && gaps[0] > 2 * Math.min(...rects.map((r) => r[mainLen]));
    if (figSB || wideEven) {
      n.layout.justify = "space-between";
      set(`${n.id}: space-between instead of a ${r2(Math.max(...gaps))}px gap (${figSB ? "Figma auto-layout" : "wide even gap measured from geometry"})`);
    } else if (gaps.length && gaps.every((g) => Math.abs(g - gaps[0]) <= 1) && gaps[0] > 0.5) {
      n.layout.gap = r2(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    } else {
      gaps.forEach((g, i) => { if (g > 0.5) addMargin(flow[i + 1], leadM, g); });
    }

    // padding: how far the content sits inside this element's own Figma box
    const content = union(rects);
    const g0 = geoOf(n);
    const g = g0 && !(g0.type === "TEXT" || g0.asset) ? g0 : null;
    const own = g ? boxRect(g.box) : null;
    if (own) {
      const pad = {
        top: Math.max(0, r2(content.y - own.y)),
        right: Math.max(0, r2(own.x + own.w - (content.x + content.w))),
        bottom: Math.max(0, r2(own.y + own.h - (content.y + content.h))),
        left: Math.max(0, r2(content.x - own.x)),
      };
      if (Object.values(pad).some((v) => v > 0.5)) { n.layout.padding = pad; set(`${n.id}: padding from box`); }
      else delete n.layout.padding;
    }

    // cross axis: all start / end / centre together -> align, else start + per-child offset margin
    const cStart = content[crossPos], cEnd = content[crossPos] + content[crossLen];
    const tol = Math.max(6, 0.01 * (cEnd - cStart));
    const starts = rects.map((r) => r[crossPos]);
    const ends = rects.map((r) => r[crossPos] + r[crossLen]);
    const centers = rects.map((r) => r[crossPos] + r[crossLen] / 2);
    const all = (arr, v) => arr.every((x) => Math.abs(x - v) <= tol);
    flow.forEach((c) => clearMargin(c, [crossLead, dir === "row" ? "bottom" : "right"]));
    if (all(starts, cStart)) n.layout.align = "start";
    else if (flow.length > 1 && all(centers, (cStart + cEnd) / 2)) n.layout.align = "center";
    else if (all(ends, cEnd)) n.layout.align = "end";
    else {
      n.layout.align = "start";
      rects.forEach((r, i) => { const off = r[crossPos] - cStart; if (off > 0.5) addMargin(flow[i], crossLead, off); });
    }

    // sizes of grouping elements
    if (n.type === "section") { if (n.size) { delete n.size.width; delete n.size.height; } }
    else if (n.size) delete n.size.height;
    const parentIsRow = parent && (parent.type === "row" || parent.layout?.direction === "row") && parent.children.length > 1;
    if (n.type !== "section") {
      const r = rectOf(n);
      const sbRow = n.layout?.justify === "space-between" && (n.layout?.direction === "row" || n.type === "row");
      if ((parentIsRow || sbRow) && r) n.size = { ...(n.size || {}), width: r2(r.w) };
      else if (n.size && typeof n.size.width === "number") delete n.size.width;
    }
    if (n.size && !Object.keys(n.size).length) delete n.size;

    // a Figma background rectangle flagged by the grouping step becomes this element's background
    if (g) {
      const bg = (g.children || []).find((c) => c.isParentBackground);
      const solid = bg && (bg.fills || []).find((f) => f.t === "SOLID");
      const gfill = bg && (bg.fills || []).find((f) => f.t === "GRADIENT_LINEAR");
      const gr = gfill && gradients.find((x) => x.nodeId === bg.id && x.appliesTo === "background");
      if (gr) { n.background = { gradient: gr.gradient }; set(`${n.id}: gradient background from Figma`); }
      else if (solid?.c) { n.background = { color: solid.c }; set(`${n.id}: background colour from Figma`); }
      if (bg && typeof bg.cornerRadius === "number" && bg.cornerRadius > 0) { n.border = { ...(n.border || {}), radius: bg.cornerRadius }; set(`${n.id}: corner radius from Figma`); }
      // a card drawn as an outline-only rectangle (stroke, no fill) is a border on the element
      const stroke = bg && (bg.strokes || []).find((s) => s.t === "SOLID" && s.c);
      if (stroke && bg.strokeWeight > 0) { n.border = { ...(n.border || {}), color: stroke.c, width: bg.strokeWeight }; set(`${n.id}: border ${bg.strokeWeight}px ${stroke.c} from Figma`); }
    }
    set(`${n.id}: ${dir} layout measured`);
  };

  // ---- heading levels (run after the text passes: they need the measured font sizes and the text->heading promotions) ----
  const levelPass = () => {
  const headings = [];
  (function walk(n) { if (n.type === "heading") headings.push(n); for (const c of n.children || []) walk(c); })({ children: doc.children || [] });
  if (headings.length) {
    const size = (h) => h.typography?.fontSize || 0;
    const biggest = headings.reduce((a, b) => (size(b) > size(a) ? b : a), headings[0]);
    // same size = same level: the biggest is H2 (H1 in a hero), the next size H3, and so on (the model's own 2/3/4 was arbitrary)
    const sizes = [...new Set(headings.map(size))].sort((a, b) => b - a);
    for (const h of headings) h.level = isHero && h === biggest ? 1 : Math.min(6, 2 + Math.max(0, sizes.indexOf(size(h)) - (isHero ? 1 : 0)));
  }
  };

  // ---- identity clean-up: ids must point at real Figma nodes, types must match the content ----
  (function idPass(n) {
    if (n.type) {
      if (n.figmaNodeId && n.figmaNodeId !== "scope" && !geo.has(n.figmaNodeId)) {
        set(`${n.id}: removed invented figmaNodeId "${n.figmaNodeId}"`);
        delete n.figmaNodeId;
      }
      if (!n.figmaNodeId && n.asset?.nodeId && geo.has(n.asset.nodeId)) n.figmaNodeId = n.asset.nodeId;
      // repeated icons: the element's own Figma node decides which asset it shows (the model tends to reuse the first icon's id)
      if (n.asset?.nodeId && n.figmaNodeId && n.asset.nodeId !== n.figmaNodeId && geo.get(n.figmaNodeId)?.asset) {
        set(`${n.id}: asset ${n.asset.nodeId} -> ${n.figmaNodeId} (its own Figma node)`);
        n.asset.nodeId = n.figmaNodeId;
      }
      if (n.type === "text-basic") {
        const g = geoOf(n);
        const t = g ? firstText(g) : null;
        if (t && typeof t.characters === "string" && (t.characters.length > 120 || t.characters.includes("\n"))) {
          n.type = "text";
          set(`${n.id}: text-basic -> text (it is paragraph copy)`);
        }
      }
    }
    for (const c of n.children || []) idPass(c);
  })({ children: doc.children || [] });

  const top = { children: doc.children || [] };
  leafPass(top, null);
  layoutPass(top, null);
  levelPass();
  return log;
}
// ----------------------------------------------------------------------------------------------
// rebuildFromGeometry: when the model's NESTING disagrees with the measured layout (e.g. text
// nested inside an image element), keep the model's leaf elements (ids, types, text, assets) but
// rebuild the grouping from the measured Figma tree: Figma frames and measured row/column groups.
// ----------------------------------------------------------------------------------------------
const LEAF_TYPES = new Set(["heading", "text", "text-basic", "button", "image", "icon", "unsupported", "spacer"]);
const isButtonFrame = (h) => isObj(h) && h.type === "FRAME" && !h.asset && h.cornerRadius > 0 && (h.fills || []).some((f) => f.t === "SOLID")
  && (h.children || []).length === 1 && h.children[0]?.type === "TEXT";
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";

// opts.lenient (split-mode stitching): parts overlap, so the model can emit the same node twice or invent an id; instead of giving up,
// keep the first copy of each node, drop the extras and record what was dropped in _uncertain.
export function rebuildFromGeometry(doc, geoTree, opts = {}) {
  const why = (m) => { if (opts.reason) opts.reason.why = m; return null; };
  const root = doc.children?.[0];
  if (!root) return why("the document has no root element");
  if (root.type !== "section") return why(`the root element is a "${root.type}", not a section`);

  const leafById = new Map();
  const wrapperById = new Map();
  const usedIds = new Set();
  const allLeaves = [];
  const geo = indexGeo(geoTree);
  (function collect(n) {
    if (!isObj(n)) return;
    if (n.type) {
      usedIds.add(n.id);
      // The model sometimes types a Figma TEXT node as a container (e.g. a section title as "block"). A TEXT node has no children to
      // rebuild, so such an element used to vanish from the stitched section. Treat it as the text leaf it really is.
      const gn = n.figmaNodeId && n.figmaNodeId !== "scope" ? geo.get(n.figmaNodeId) : null;
      if (gn && gn.type === "TEXT" && n !== root && !LEAF_TYPES.has(n.type)) { n.type = "text"; delete n.children; }
      if (LEAF_TYPES.has(n.type)) {
        allLeaves.push(n);
        const key = n.figmaNodeId || n.asset?.nodeId;
        if (key && !leafById.has(key)) leafById.set(key, n);
        if (n.asset?.nodeId && !leafById.has(n.asset.nodeId)) leafById.set(n.asset.nodeId, n);
      } else if (n.figmaNodeId && n !== root) wrapperById.set(n.figmaNodeId, n);
    }
    for (const c of n.children || []) collect(c);
  })({ children: doc.children });

  const fresh = (base) => { let i = 1, id; do { id = `${slug(base)}-${i++}`; } while (usedIds.has(id)); usedIds.add(id); return id; };
  const placed = new Set();

  const toElements = (h, parentId) => {
    if (!isObj(h)) return [];
    if (h.g) {
      const type = h.g === "row" ? "row" : "column";
      const kids = (h.children || []).flatMap((c) => toElements(c, parentId));
      if (kids.length <= 1) return kids;
      return [{ type, id: fresh(`${parentId}-${type}`), children: kids }];
    }
    // A pill/rectangle frame holding only a label is a button, however the model typed it (a wrapper div around a button, or plain text):
    // the stitched section gets ONE button element for it, styled from the frame.
    if (isButtonFrame(h)) {
      const lab = h.children[0];
      const own = leafById.get(h.id), inner = leafById.get(lab.id), wrap = wrapperById.get(h.id);
      const base = own || inner || wrap;
      if (base && !(placed.has(own) && own) && !(placed.has(inner) && inner)) {
        for (const l of [own, inner]) if (l) placed.add(l);
        return [{ type: "button", id: base.id, figmaNodeId: h.id, text: typeof lab.characters === "string" ? lab.characters : "" }];
      }
    }
    const leaf = leafById.get(h.id);
    if (leaf && !placed.has(leaf)) {
      placed.add(leaf);
      const { children, ...rest } = leaf;
      return [rest];
    }
    if (h.children?.length && !h.asset) {
      const kids = h.children.flatMap((c) => toElements(c, parentId));
      if (!kids.length) return [];
      // a frame/group that owns a background rectangle (card gradient, fill, radius) must stay a real element, even with one child
      const ownsBg = h.children.some((c) => isObj(c) && c.isParentBackground);
      if (kids.length === 1 && !wrapperById.has(h.id) && !ownsBg) return kids;
      const w = wrapperById.get(h.id);
      if (w && opts.lenient) {
        // split-mode stitch: parts were answered separately, so the model's wrapper layout/size/type is unreliable (one card kept its own gap and
        // zero padding). Keep only its visual styling; layout, sizes and padding are re-measured from Figma.
        const keep = {};
        for (const k of ["background", "border", "boxShadow"]) if (w[k]) keep[k] = w[k];
        return [{ type: h.layoutMode === "HORIZONTAL" ? "row" : "column", id: w.id, figmaNodeId: h.id, ...keep, children: kids }];
      }
      if (w) { const { children, ...rest } = w; return [{ ...rest, children: kids }]; }
      const type = h.layoutMode === "HORIZONTAL" ? "row" : "column";
      return [{ type, id: fresh(h.name || `${parentId}-${type}`), figmaNodeId: h.id, children: kids }];
    }
    return [];
  };

  const base = root.figmaNodeId && root.figmaNodeId !== "scope" && geo.get(root.figmaNodeId) ? geo.get(root.figmaNodeId) : geoTree;
  let kids = (base.children || []).flatMap((c) => toElements(c, root.id));
  // a single measured column directly inside a section is redundant (sections are columns already)
  if (kids.length === 1 && kids[0].type === "column" && !wrapperById.has(kids[0].figmaNodeId)) kids = kids[0].children;
  if (!kids.length) return why("none of the model's elements matched a node in the Figma layout");
  // every leaf the model produced must still be present
  const unplaced = (opts.lenient ? allLeaves : [...new Set(leafById.values())]).filter((l) => !placed.has(l));
  if (unplaced.length && !opts.lenient) return why(`${unplaced.length} element(s) could not be placed`);

  const { children, ...rootRest } = root;
  const out = { ...doc, children: [{ ...rootRest, children: kids }, ...doc.children.slice(1)] };
  if (unplaced.length) {
    const dup = unplaced.filter((l) => { const k = l.figmaNodeId || l.asset?.nodeId; return k && geo.has(k); }).length;
    const orphan = unplaced.length - dup;
    const msg = `stitch: dropped ${dup} duplicate element(s) emitted by overlapping parts${orphan ? ` and ${orphan} element(s) whose Figma node id does not exist (${unplaced.filter((l) => { const k = l.figmaNodeId || l.asset?.nodeId; return !(k && geo.has(k)); }).slice(0, 4).map((l) => l.id).join(", ")})` : ""}`;
    out._uncertain = [...new Set([...(out._uncertain || []), msg])];
    console.warn("  " + msg);
  }
  return out;
}