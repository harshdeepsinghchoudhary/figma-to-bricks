/**
 * Deterministic "make it responsive" pass over a validated normalized tree. No LLM.
 *
 * Figma frames are fixed-width desktop designs; Bricks pages are fluid. This pass applies the conventions seen in
 * the hand-built reference (homepage.json) so stage 3 output behaves like it:
 *
 *   1. section  -> section(padding) > container(layout, widthMax = measured content width), 16px side padding
 *   2. fixed px widths -> _widthMax:Npx + _width:100%  (children that just fill their parent get no width at all)
 *   3. rows whose children span the content width -> justify space-between with a small minimum gap
 *   4. images drop their fixed height (aspect ratio is kept by the asset)
 *   5. tablet_portrait: rows collapse to columns, big vertical padding / margins shrink, max widths go to 100%
 *   6. mobile_landscape: vertical padding / margins shrink further
 *   7. button with a pre-exported icon note -> real Bricks button icon
 *   8. optional font aliases from font-aliases.json in the project root ({"Source Sans Pro": "Source Sans 3"})
 *
 * Everything is a rule over measured numbers; the tunable constants are below. Returns { doc, report }.
 */
const MIN_GAP = 20;            // gap kept between row children once they use space-between
const STACKED_GAP = 40;        // gap between children after a row collapses to a column
const SITE_WIDTH = 1200;       // the page container: every section's container is this wide, narrower content is sized by its own wrapper
const SIDE_PADDING = 16;       // section left/right padding once content lives in a max-width container
const BIG_PAD = 120;           // vertical padding >= this becomes BIG_PAD at tablet
const TABLET_PAD_MOBILE = 60;  // and at most this on mobile
const BIG_MARGIN = 60;         // vertical margins above this get scaled down on smaller screens
const ICON_MAX = 48;             // an SVG asset up to this wide is an icon, not an image
const FILL_TOLERANCE = 0.97;   // a child at least this fraction of its parent's width is treated as "fills parent"

import { BRICKS_BREAKPOINTS } from "./breakpoints.js";
const T = BRICKS_BREAKPOINTS.tablet, M = BRICKS_BREAKPOINTS.mobile;
const isNum = (v) => typeof v === "number" && isFinite(v);
const isRowish = (n) => n.type === "row" || n.layout?.direction === "row";
const gapOf = (n) => n.layout?.columnGap ?? n.layout?.gap ?? 0;

// cap: ignore explicit widths above it (full-bleed bands / backgrounds say nothing about the content width)
function nodeWidth(n, cap = Infinity) {
  if (isNum(n._measuredRowWidth)) return n._measuredRowWidth > cap ? 0 : n._measuredRowWidth;
  if (isNum(n.size?.width)) return n.size.width > cap ? 0 : n.size.width;
  const kids = (n.children || []).filter((c) => !c.abs).map((c) => nodeWidth(c, cap)).filter((w) => w > 0);
  if (!kids.length) return 0;
  if (n.layout?.display === "grid" && n._grid && n.layout.gridColumns > 0) { // a measured grid: columns x widest card + gaps
    const cols = Math.min(n.layout.gridColumns, kids.length);
    return Math.max(...kids) * cols + (n.layout.gridGap ?? 0) * (cols - 1);
  }
  return isRowish(n) ? kids.reduce((a, b) => a + b, 0) + gapOf(n) * (kids.length - 1) : Math.max(...kids);
}

// A row that is just a small icon next to its text (bullet + label, check + heading) stays a row on every screen size.
function isInlineRow(n) {
  if (!isRowish(n)) return false;
  const kids = rendered(n);
  if (kids.length < 2 || kids.length > 3) return false;
  const textBranch=k=>['text','text-basic','heading','button'].includes(k.type)||!!k.children?.length&&k.children.every(textBranch);
  if (!kids.every((k) => GRID_LEAVES.has(k.type)||textBranch(k))) return false;
  return kids.some((k) => (k.type === "icon" || k.type === "image") && isNum(k.size?.width) && k.size.width <= 48);
}

// A row is a grid when it has 2+ children that are all containers (not icons/text/images) of (nearly) the same width.
const TEXTLEAF = new Set(["heading", "text", "text-basic", "button", "image", "icon"]);
const GRID_LEAVES = new Set(["heading", "text", "text-basic", "button", "image", "icon", "unsupported", "spacer"]);
const rendered = (n) => (n.children || []).filter((k) => k.type !== "unsupported" && !k.abs); // absolutely placed layers and dividers the compiler skips don't take part in layout
function gridCandidate(n) {
  const kids = rendered(n);
  if (kids.length < 2 || kids.length > 6) return false;
  if (!kids.every((k) => !GRID_LEAVES.has(k.type) && (k.children || []).length > 0)) return false;
  const ws = kids.map((k) => nodeWidth(k));
  if (ws.some((w) => !(w > 0))) return false;
  return Math.max(...ws) - Math.min(...ws) <= Math.max(2, Math.max(...ws) * 0.02);
}

function ensure(n, bp) { n.responsive = n.responsive || {}; n.responsive[bp] = n.responsive[bp] || {}; return n.responsive[bp]; }
function setResp(n, bp, patch) {
  const r = ensure(n, bp);
  for (const [k, v] of Object.entries(patch)) r[k] = { ...(r[k] || {}), ...v };
}
const r1 = (v) => Math.round(v * 10) / 10;

export function responsify(input, { manifest = [], fontAliases = {}, geo = {}, texts = {}, siteWidth = 0 } = {}) {
  if (BRICKS_BREAKPOINTS.isMobileFirst) throw new Error("The current responsive inference uses desktop-first layouts. Use explicit responsive data and --no-responsive for a mobile-first Bricks site.");
  // the page container width comes from the design (see 3_compile_bricks.js); SITE_WIDTH is only the fallback when the design has no usable frames
  const SITE = siteWidth > 0 ? siteWidth : SITE_WIDTH;
  const doc = JSON.parse(JSON.stringify(input));
  const report = [];
  const log = (m) => report.push(m);

  // ---- per-node rules (everything except the section/container restructure) ----
  function fixNode(n, parent, contentW) {
    if (isNum(n._measuredRowWidth)) n.size = { ...(n.size || {}), width: n._measuredRowWidth };
    // Native menu/slider/tab/accordion wrappers own their responsive behavior.
    // Generic equal-card and row-stacking rules would break their JS structure.
    if (n._nativeLayoutLock) {
      if (n.typography?.fontFamily && fontAliases[n.typography.fontFamily]) n.typography.fontFamily = fontAliases[n.typography.fontFamily];
      for (const c of n.children || []) fixNode(c, n, contentW);
      return;
    }
    // fonts
    if (n.typography?.fontFamily && fontAliases[n.typography.fontFamily]) {
      log(`font ${n.typography.fontFamily} -> ${fontAliases[n.typography.fontFamily]} on ${n.id}`);
      n.typography.fontFamily = fontAliases[n.typography.fontFamily];
    }
    // text case from Figma (UPPER/LOWER/TITLE) and plain spaces instead of non-breaking ones, for sections normalized before post-processing did this
    if ((n.type === "heading" || n.type === "text" || n.type === "text-basic" || n.type === "button") && n.figmaNodeId && texts[n.figmaNodeId]) {
      const tt = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" }[texts[n.figmaNodeId].textCase];
      if (tt && !n.typography?.textTransform) n.typography = { ...(n.typography || {}), textTransform: tt };
    }
    if (typeof n.text === "string" && n.text.includes("\u00a0")) n.text = n.text.replace(/\u00a0/g, " ");
    // button icon from the pre-exported icon note
    if (n.type === "button" && n.notes) {
      for (const note of n.notes) {
        const m = /pre-exported[^()]*icon[^()]*\(([^)]+)\)/i.exec(note);
        const a = m && manifest.find((x) => x.nodeId === m[1].trim());
        if (a) { n._buttonIconFile = a.file; n._buttonIconNodeId = a.nodeId; n.notes = n.notes.filter((x) => x !== note); log(`button ${n.id}: icon ${a.file}`); }
      }
    }

    // A small SVG export is an icon, whichever of icon/image the model picked: split-mode parts are answered separately, so the same kind of
    // asset comes back typed differently from card to card. As an image it would lose the icon's fixed height and sizing.
    if (n.type === "image" && n.asset?.nodeId && isNum(n.size?.width) && n.size.width <= ICON_MAX) {
      const a = manifest.find((x) => x.nodeId === n.asset.nodeId);
      if (a && /\.svg$/i.test(a.file)) { n.type = "icon"; log(`image ${n.id} -> icon (${r1(n.size.width)}px SVG)`); }
    }

    // absolutely placed layer (structure rules): size and position come from `abs`, none of the flow rules below apply
    if (n.abs) { for (const c of n.children || []) fixNode(c, n, contentW); return; }

    n._inline = isInlineRow(n); // decided before the children are rewritten (their widths change below)
    if(n._inline){
      setResp(n,T,{layout:{direction:'row',align:n.layout?.align||'start',rowGap:gapOf(n),columnGap:gapOf(n)}});
    }
    if(n.type==='heading' && n.typography?.fontSize>32 && !n.responsive?.[M]?.typography?.fontSize){
      setResp(n,M,{typography:{fontSize:Math.min(n.typography.fontSize,32),lineHeight:'125%'}});
    }
    const parentGrid = parent && parent.layout?.display === "grid";
    const parentRow = parent && isRowish(parent) && !parentGrid;
    const w = n.size?.width;
    if (isNum(w)) n._origW = w; // the parent's ORIGINAL width, since n.size.width gets rewritten to "fill" below
    if (parentGrid && isNum(w)) { delete n.size.width; if (!Object.keys(n.size).length) delete n.size; } // a grid column sizes itself

    if (n.type === "image") {
      if (n.size && "height" in n.size) delete n.size.height;
    }
    // Flow containers must grow when text wraps or columns stack. Keep the
    // desktop measurement as a minimum, never as a clipping fixed height.
    if(n.children?.length && !n.abs && !n.figma?.geometryPositioned && !n.figma?.geometryLayered && isNum(n.size?.height)){
      n.size.minHeight=n.size.height;delete n.size.height;
      setResp(n,T,{size:{height:'auto',minHeight:0}});
    }
    if (isNum(w) && parent && !parentGrid) {
      const pw = parent._origW ?? parent._contentW ?? 0;
      const fillsParent = !parentRow && n.type !== "image" && pw > 0 && w >= pw * FILL_TOLERANCE && w <= pw * 1.02;
      // one line of text: a width taken from Figma is the exact width of that font's rendering, so a slightly wider rendering in the browser
      // wraps the last word onto a second line (the 34px title did). Let it take its natural width instead.
      const box = geo[n.figmaNodeId];
      const lh = Number(n.typography?.lineHeight) || (n.typography?.fontSize ? n.typography.fontSize * 1.25 : 0);
      const singleLine = (n.type === "heading" || n.type === "text" || n.type === "text-basic") && box?.height && lh && box.height <= lh * 1.4;
      // a child that fills its parent says so (width 100%) when the parent is a container or centres its children - otherwise a centred flex
      // column shrinks it to its content, and the container is now wider than the measured content
      if (isNum(n._measuredRowWidth)) { n.size.width = "fill"; n.size.maxWidth = n._measuredRowWidth; }
      else if (fillsParent && n.type === "button") n.size.width = "fill";
      else if (fillsParent) { if (!TEXTLEAF.has(n.type) && (parent.type === "container" || ["start", "center", "end"].includes(parent.layout?.align))) n.size.width = "fill"; else if (["center", "right"].includes(n.typography?.align)) n.size.width = "fill"; else delete n.size.width; }
      else if (singleLine) { delete n.size.width; log(`single-line text ${n.id}: no fixed width (avoids wrapping from font differences)`); }
      else {
        n.size.maxWidth = Math.floor(w); n.size.width = "fill";
        if (parentRow && !parent._inline) setResp(n, T, { size: { maxWidth: "100%" } });
      }
    }
    // a container-div with no width of its own inside a column shrinks to its content (flex-start / center), so it states width 100%.
    // When the parent centres it and it is narrower than the parent, its measured width becomes the max-width.
    if (!isNum(w) && parent && !parentGrid && !parentRow && parent.type !== "page" && parent.type !== "section"
        && (n.type === "row" || n.type === "column") && (n.children || []).length > 0 && !n.size?.width && !n._inline) {
      const nw = nodeWidth({ ...n, size: undefined }), pw = parent._origW ?? parent._contentW ?? 0;
      if (pw > 0 && nw >= pw * 0.9) n.size = { ...(n.size || {}), width: "fill" };
      if (parent.layout?.align === "center" && nw > 0 && pw > nw + 2 && parent.size?.maxWidth !== Math.floor(nw) && !isNum(n.size?.maxWidth)) n.size = { ...(n.size || {}), maxWidth: Math.floor(nw) };
    }
    // a child nudged down to line up with a sibling in a row doesn't need that once stacked
    if (parentRow && n.layout?.margin?.top) setResp(n, T, { layout: { margin: { top: 0 } } });
    // a child that is 100% wide and also has a side margin is wider than its parent: let a stretching parent do the filling instead
    if (n.size?.width === "fill" && (n.layout?.margin?.left || n.layout?.margin?.right) && parent && !parentRow && !parentGrid
        && !["center", "start", "end"].includes(parent.layout?.align)) delete n.size.width;
    // very wide side padding is a desktop-only offset (text pushed to one side of a banner): shrink it on small screens
    // (both sides in ONE override: two separate overrides replaced each other, so a wide LEFT padding survived on phones and overflowed)
    {
      const wide = ["left", "right"].filter((side) => Number(n.layout?.padding?.[side]) > 20);
      if (wide.length) {
        setResp(n, T, { layout: { padding: Object.fromEntries(wide.map((side) => [side, 20])) } });
        setResp(n, M, { layout: { padding: Object.fromEntries(wide.map((side) => [side, Math.min(Number(n.layout.padding[side]), 20)])) } });
      }
    }
    // a big side margin is a desktop-only offset (a heading centred by a margin): drop it on tablet and phone
    {
      const big = ["left", "right"].filter((side) => Number(n.layout?.margin?.[side]) > 60);
      if (big.length) {
        setResp(n, T, { layout: { margin: Object.fromEntries(big.map((side) => [side, 0])) } });
        setResp(n, M, { layout: { margin: Object.fromEntries(big.map((side) => [side, 0])) } });
      }
    }
    // side offsets that only line a child up inside a row would push the stacked (100% wide) child out of the screen
    if (parentRow && (n.layout?.margin?.left || n.layout?.margin?.right)) setResp(n, T, { layout: { margin: { left: 0, right: 0 } } });

    // big vertical margins shrink on smaller screens
    const mt = n.layout?.margin?.top;
    if (isNum(mt) && mt > BIG_MARGIN && n.type !== "section") {
      const t = Math.round(mt / 2);
      setResp(n, T, { layout: { margin: { top: t } } });
      setResp(n, M, { layout: { margin: { top: Math.min(t, STACKED_GAP) } } });
    }

    // rows of equal-width containers (cards, pros/cons columns, feature blocks) are a grid, not a flex row
    // finishGrid: what every grid needs once its columns are known - shared card padding, fill width, tablet / mobile column counts
    const finishGrid = (cols, gap) => {
      const stacked = Math.min(gap || STACKED_GAP, STACKED_GAP);
      // sibling cards share one padding (Figma measures each from its own content, which differs by a pixel or two between cards)
      const pads = n.children.map((k) => k.layout?.padding).filter(Boolean);
      if (pads.length === n.children.length) {
        const sides = ["top", "right", "bottom", "left"];
        const spread = Math.max(...sides.map((sd) => Math.max(...pads.map((q) => q[sd] ?? 0)) - Math.min(...pads.map((q) => q[sd] ?? 0))));
        if (spread > 0 && spread <= 8) { const m = Object.fromEntries(sides.map((sd) => [sd, Math.max(...pads.map((q) => q[sd] ?? 0))])); for (const k of n.children) k.layout.padding = { ...m }; log(`grid: ${n.id} cards share padding ${m.top}/${m.right}/${m.bottom}/${m.left}`); }
      }
      if (!n.size?.width || n.size.width === "fill" || n.size.width === "hug") n.size = { ...(n.size || {}), width: "fill" }; // "hug" (Auto Layout hug) would otherwise shrink the row and swallow the spread
      const rowGapOverride = n.layout.gridRowGap !== undefined ? { gridRowGap: stacked } : {};
      setResp(n, T, { layout: { gridColumns: Math.max(1,Math.ceil(cols/2)), gridGap: stacked, ...rowGapOverride } });
      setResp(n, M, { layout: { gridColumns: 1 } });
      setResp(n, "mobile_portrait", { layout: { gridColumns: 1 } });
    };
    if (n.layout?.display === "grid" && n._grid && n.layout.gridColumns) {
      // already a measured grid (structure rules): keep its columns and gaps, add the responsive behaviour
      finishGrid(n.layout.gridColumns, n.layout.gridGap);
      log(`grid: ${n.id} -> ${n.layout.gridColumns} columns (measured), gap ${n.layout.gridGap}`);
    }
    else if (isRowish(n) && n.type !== "section" && gridCandidate(n)) {
      n.children = rendered(n); // an equal-column grid has no room for a divider cell
      const cols = n.children.length;
      const gap = gapOf(n);
      n.layout = { ...n.layout, display: "grid", gridColumns: cols, gridGap: gap, align: n.layout?.align === 'end' ? 'end' : "stretch" };
      delete n.layout.justify; delete n.layout.gap; delete n.layout.columnGap; delete n.layout.rowGap; delete n.layout.direction;
      finishGrid(cols, gap);
      log(`grid: ${n.id} -> ${cols} equal columns, gap ${gap}`);
    }
    // rows: spread across the width, collapse on tablet
    else if (isRowish(n) && n.type !== "section" && rendered(n).length >= 2 && !n._inline) {
      const kids = rendered(n);
      const total = nodeWidth({ ...n, size: undefined });
      const boxes=kids.map(k=>geo[k.figmaNodeId]);
      const gaps=boxes.every(Boolean)?boxes.slice(1).map((b,i)=>b.x-boxes[i].x-boxes[i].width):[];
      const distributed=gaps.length>0 && gaps.every(g=>g>80) && Math.max(...gaps)-Math.min(...gaps)<=2 && boxes.every(b=>Math.abs(b.y-boxes[0].y)<=Math.max(2,Math.min(b.height,boxes[0].height)));
      if(distributed){
        const span=boxes.at(-1).x+boxes.at(-1).width-boxes[0].x+(Number(n.layout?.padding?.left)||0)+(Number(n.layout?.padding?.right)||0);
        n.size={...(n.size||{}),width:'fill',maxWidth:span};
        n.layout={...n.layout,justify:'space-between',gap:20};delete n.layout.columnGap;delete n.layout.rowGap;
        n._distributedRow=true;
        log(`row ${n.id}: measured ${span}px content span, gap over 80px -> fluid width with space-between`);
      }
      else if (!isNum(n._measuredRowWidth) && contentW && total >= contentW * 0.9 && kids.every((k) => nodeWidth(k) > 0)) {
        n.layout = { ...n.layout, justify: "space-between", gap: MIN_GAP };
        delete n.layout.columnGap; delete n.layout.rowGap;
        // a row that spreads its children must span its parent, or a centered parent shrinks it to its content
        if (!n.size?.width || n.size.width === "fill" || n.size.width === "hug") n.size = { ...(n.size || {}), width: "fill" }; // "hug" (Auto Layout hug) would otherwise shrink the row and swallow the spread
      }
      setResp(n, T, { layout: { direction: "column", align: "center", rowGap: STACKED_GAP } });
    }

    const w2 = n._distributedRow ? n.size.maxWidth : nodeWidth(n);
    n._contentW = w2;
    for (const c of n.children || []) fixNode(c, n, contentW);
    // Compact labels are an inline list, not equal-width cards or a tall
    // mobile column. Evidence comes from content, not a particular page ID.
    const plainLabel=k=>['text','text-basic','heading'].includes(k.type)&&String(k.text||'').length<=40&&!String(k.text||'').includes('\n')||k.children?.length===1&&plainLabel(k.children[0]);
    const children=rendered(n);
    if(isRowish(n)&&children.length>=4&&children.every(plainLabel)){
      n.layout={...n.layout,wrap:true,align:'center'};
      setResp(n,T,{layout:{direction:'row',wrap:true,justify:'center',rowGap:16}});
      for(const child of children){child.size={...child.size,width:'hug'};delete child.size.maxWidth;}
    }
    const action=k=>k.type==='button'||k.type==='link'||!!k.background&&!!k.children?.length&&k.children.every(c=>['text','text-basic','icon','image'].includes(c.type));
    if(isRowish(n)&&children.length>=2&&children.length<=3&&children.every(action)){
      setResp(n,T,{layout:{direction:'row',wrap:true,align:'center',rowGap:12}});
      setResp(n,'mobile_portrait',{layout:{direction:'column',align:'start',rowGap:12}});
    }
    // Centering expressed as hundreds of pixels of symmetric empty padding
    // must become alignment so that the same heading fits smaller screens.
    const p=n.layout?.padding;
    if(children.length===1&&plainLabel(children[0])&&p?.left>40&&Math.abs(p.left-p.right)<=2){
      n.layout.padding={...p,left:0,right:0};n.layout.align='center';n.layout.justify='center';
      for(const r of Object.values(n.responsive||{}))if(r.layout?.padding){r.layout.padding.left=0;r.layout.padding.right=0;}
    }
    delete n._contentW; delete n._origW; delete n._inline;
  }

  // Layers: a full-bleed image child becomes the section's background image (its gradient fill becomes an overlay),
  // and images flagged with an opacity note become absolutely positioned decoration, placed from the Figma geometry.
  function pullLayers(sec) {
    const secBox = geo[sec.figmaNodeId];
    const secW = sec.size?.width ?? secBox?.width;
    const decor = [];
    if (!secW) {
      // no Figma width for the section: layers placed by structure-rules.js are still pulled out of the flow
      const keepAll = [];
      for (const c of sec.children || []) { if (c.abs && c.abs.z !== undefined) { decor.push(c); log(`section ${sec.id}: ${c.id} -> absolute decoration layer at ${c.abs.left}, ${c.abs.top}`); } else keepAll.push(c); }
      sec.children = keepAll;
      return { cap: Infinity, decor };
    }
    const keep = [];
    for (const c of sec.children || []) {
      if (c.abs && c.abs.z !== undefined) { decor.push(c); log(`section ${sec.id}: ${c.id} -> absolute decoration layer at ${c.abs.left}, ${c.abs.top}`); continue; } // placed by structure-rules.js
      const w = c.size?.width;
      if (c.type === "image" && !sec._bgImage && isNum(w) && w >= secW * 0.9) {
        sec._bgImage = c;
        log(`section ${sec.id}: full-bleed image ${c.id} -> section background image`);
        continue;
      }
      const op = c.type === "image" && (c.notes || []).map((x) => /opacity\s*:?\s*([0-9.]+)/i.exec(x)).find(Boolean);
      const box = geo[c.figmaNodeId];
      if (op && box && secBox) {
        c.abs = {
          left: `${r1(((box.x - secBox.x) / secW) * 100)}%`,
          top: `${Math.round(box.y - secBox.y)}px`,
          width: Math.round(box.width),
          opacity: Number(op[1]),
        };
        c.notes = (c.notes || []).filter((x) => !/opacity/i.test(x));
        decor.push(c);
        log(`section ${sec.id}: ${c.id} -> absolute layer at ${c.abs.left}, ${c.abs.top}, opacity ${c.abs.opacity}`);
        continue;
      }
      keep.push(c);
    }
    sec.children = keep;
    if (sec._bgImage && sec.background?.gradient) {
      sec._overlay = sec.background.gradient;
      delete sec.background.gradient;
      if (!Object.keys(sec.background).length) delete sec.background;
      log(`section ${sec.id}: gradient fill -> overlay on the background image`);
    }
    return { cap: secW * 0.95, decor };
  }

  function fixSection(sec) {
    if(isNum(sec.size?.height)){
      sec.size.minHeight=sec.size.height;delete sec.size.height;
      setResp(sec,T,{size:{height:'auto',minHeight:0}});
    }
    const pad = sec.layout?.padding || {};
    // The model sometimes gives the section the Figma id/asset of its full-width banner picture instead of emitting an image child, so the
    // picture was never placed. A raster asset on the section itself is its background image.
    const ownAsset = sec.asset?.nodeId && manifest.find((x) => x.nodeId === sec.asset.nodeId);
    if (ownAsset && /\.(png|jpe?g|webp)$/i.test(ownAsset.file) && !sec._bgImage) {
      sec._bgImage = { type: "image", id: `${sec.id}-bg`, asset: { nodeId: sec.asset.nodeId } };
      delete sec.asset;
      log(`section ${sec.id}: its own picture asset ${ownAsset.nodeId} -> section background image`);
    }
    // full-width strips (a footer's line + copyright) are not part of the site-width container: they sit beside it in the section
    const strips = (sec.children || []).filter((c) => c._fullBleed);
    if (strips.length) sec.children = sec.children.filter((c) => !c._fullBleed);
    const { cap, decor } = pullLayers(sec);
    const contentW = Math.round(Math.max(nodeWidth({ ...sec, size: undefined, layout: sec.layout }, cap), 0));
    const kidsW = Math.round(Math.max(0, ...(sec.children || []).map((c) => nodeWidth(c, cap))));
    const cw = Math.max(contentW, kidsW);

    // 1) container: takes the section's flex layout; section keeps padding/margin/background
    const { padding, margin, ...flexLayout } = sec.layout || {};
    const container = {
      type: "container",
      id: `${sec.id}-container`,
      layout: { display: "flex", direction: "column", ...flexLayout },
      // width fill + widthMax: Bricks containers default to a fixed 1100px wide, which would beat a larger max-width
      size: { width: "fill", maxWidth: sec._fullBleedContent ? '100%' : sec._sourceContainerWidth || SITE },
      children: sec.children || [],
    };
    // content narrower than the site container (a 619px hero column): the single block inside the container carries that width
    const only = container.children.length === 1 ? container.children[0] : null;
    if (sec._scopeW) {
      // the whole scope is narrower than the site container (a 1003px FAQ frame): the container itself carries that width, its content fills it
      container.size.maxWidth = sec._scopeW;
      if (only && !TEXTLEAF.has(only.type) && !isNum(only.size?.maxWidth)) only.size = { ...(only.size || {}), width: "fill" };
      log(`section ${sec.id}: container max-width ${sec._scopeW}px from the Figma frame width`);
    } else if (only && !TEXTLEAF.has(only.type) && cw > 0 && cw < (sec._sourceContainerWidth || SITE) - 1 && (!sec._sourceContainerWidth || only.figma?.absoluteBoundingBox?.width < sec._sourceContainerWidth-1) && !isNum(only.size?.maxWidth)) only.size = { ...(only.size || {}), width: "fill", maxWidth: cw };
    if (sec._card) {
      // a card panel (rectangle + decoration) behind the content: the container IS the card
      const c = sec._card;
      container.background = { color: c.color };
      if (c.radius) container.border = { radius: c.radius };
      container.layout.padding = { top: c.top, right: SIDE_PADDING, bottom: c.bottom, left: SIDE_PADDING };
      container.layout.align = "center";
      container.size.maxWidth = c.width;
      container._pseudo = c.layers;
      container.children.forEach((k) => { if (isNum(k.size?.width)) { k.size.maxWidth = k.size.maxWidth ?? k.size.width; k.size.width = "fill"; } });
      log(`section ${sec.id}: container is the ${c.width}px card (${c.color}, padding ${c.top}/${SIDE_PADDING}/${c.bottom}/${SIDE_PADDING}, ${c.layers.length} pseudo-element layer(s))`);
      delete sec._card;
    }
    if (sec._pseudo) { sec._layered = true; container._raise = true; }
    // with a full-width strip beside it the section cannot have side padding (the strip would stop short of the screen edge): the container
    // carries the side padding instead
    sec.layout = { padding: strips.length || sec._fullBleedContent ? { ...pad, left: 0, right: 0 } : { ...pad, left: SIDE_PADDING, right: SIDE_PADDING }, ...(margin ? { margin } : {}) };
    if (strips.length) {
      container.layout.padding = { ...(container.layout.padding || {}), left: SIDE_PADDING, right: SIDE_PADDING };
      const gapAbove = Math.max(0, ...strips.map((c) => c._stripGap || 0));
      if (gapAbove > 0) container.layout.padding.bottom = gapAbove;
    }
    if (sec.size) { delete sec.size.width; delete sec.size.maxWidth; if (!Object.keys(sec.size).length) delete sec.size; } // sections are full-width by nature
    if (sec._bgImage || decor.length) { sec._layered = true; container._raise = true; }
    const stripEls = strips.map((c) => {
      delete c._fullBleed; delete c._stripGap;
      const lay = { display: "flex", direction: "column", ...(c.layout || {}) };
      delete lay.margin;
      return { ...c, type: "container", layout: lay, size: { ...(c.size || {}), width: "fill", minWidth: "fill", maxWidth: undefined } };
    });
    sec.children = [container, ...stripEls, ...decor];
    log(`section ${sec.id}: wrapped in container (widthMax ${cw || "-"}px), side padding ${pad.left ?? 0}/${pad.right ?? 0} -> ${SIDE_PADDING}`);

    // 5/6) vertical padding scales down
    const tp = {}, mp = {};
    for (const side of ["top", "bottom"]) {
      const v = pad[side];
      if (!isNum(v) || v <= 0) continue;
      const t = v >= BIG_PAD ? BIG_PAD : Math.round(v / 2);
      tp[side] = t; mp[side] = Math.min(t, TABLET_PAD_MOBILE);
    }
    if (Object.keys(tp).length) setResp(sec, T, { layout: { padding: tp } });
    if (Object.keys(mp).length) setResp(sec, M, { layout: { padding: mp } });

    // the container is handled like any other row/column node (no parent), then recursion covers its children
    fixNode(container, undefined, cw);
    for (const st of stripEls) fixNode(st, undefined, Infinity);
  }

  function walk(n) {
    if (n.type === "page") { for (const c of n.children || []) walk(c); return; }
    if (n.type === "section") fixSection(n);
  }
  walk(doc);
  return { doc, report };
}
