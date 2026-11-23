/** Measured Figma properties stay outside model interpretation and Bricks setting names. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasImageFill, isGraphicNode } from "./graphic-detect.js";
import { resolveLinearGradient } from "./gradient-utils.js";

const copy = (value) => structuredClone(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const SOURCE_KEYS = ["name", "type", "visible", "locked", "opacity", "blendMode", "absoluteBoundingBox", "absoluteRenderBounds", "size", "relativeTransform", "rotation", "constraints", "layoutMode", "layoutWrap", "layoutPositioning", "layoutSizingHorizontal", "layoutSizingVertical", "primaryAxisSizingMode", "counterAxisSizingMode", "primaryAxisAlignItems", "counterAxisAlignItems", "counterAxisAlignContent", "itemSpacing", "counterAxisSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "layoutGrow", "layoutAlign", "minWidth", "maxWidth", "minHeight", "maxHeight", "clipsContent", "isMask", "maskType", "fills", "strokes", "strokeWeight", "strokeAlign", "individualStrokeWeights", "cornerRadius", "rectangleCornerRadii", "cornerSmoothing", "effects", "style", "characterStyleOverrides", "styleOverrideTable", "paragraphIndent", "paragraphSpacing", "textAutoResize", "componentId", "componentProperties", "componentPropertyDefinitions", "variantProperties", "reactions", "transitionNodeID", "transitionDuration", "transitionEasing", "boundVariables", "styles", "gridColumnCount", "gridRowCount", "gridColumnGap", "gridRowGap", "gridColumnsSizing", "gridRowsSizing", "gridChildHorizontalAlign", "gridChildVerticalAlign", "gridRowSpan", "gridColumnSpan", "gridColumnAnchorIndex", "gridRowAnchorIndex", "targetAspectRatio", "preserveRatio"];

export function preservedNode(node, parentId = null) {
  const out = { parentId, childIds: (node.children || []).map((child) => child.id) };
  for (const key of SOURCE_KEYS) if (node[key] !== undefined) out[key] = copy(node[key]);
  if (node.characters !== undefined) out.characters = node.characters;
  // New API properties remain recoverable even before a native mapping exists.
  // Large path payloads stay in the original raw cache instead of being duplicated per normalized element.
  const geometryKeys = new Set(["vectorPaths", "fillGeometry", "strokeGeometry", "vectorNetwork"]);
  const extra = {};
  for (const [key, value] of Object.entries(node)) {
    if (["id", "children", "characters"].includes(key) || SOURCE_KEYS.includes(key)) continue;
    if (geometryKeys.has(key)) (out.rawGeometryFields ||= []).push(key);
    else extra[key] = copy(value);
  }
  if (Object.keys(extra).length) out.extraSourceProperties = extra;
  return out;
}

/** Refresh is recoverable, including same-id assets that a new export will replace. */
export function backupExtraction(dir) {
  const target = path.resolve(dir);
  const backup = path.join(target, "extract-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  const relative = path.relative(target, backup);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Extraction backup must stay within its frame folder");
  const files = ["figma-node.json", "figma-file-metadata.json", "figma-preserved.json", "extract-source.json", "screenshot.png", "asset-manifest.json", "asset-manifest.planned.json", "candidates.json", "assets"];
  const available = files.filter((name) => fs.existsSync(path.join(target, name)));
  if (!available.length) return null;
  fs.mkdirSync(backup, { recursive: true });
  for (const name of available) fs.cpSync(path.join(target, name), path.join(backup, name), { recursive: true });
  return backup;
}

/** Raw image fills for editable frames; a rendered-node PNG also includes its children. */
export function collectImageFillSources(root) {
  const out = [];
  (function walk(node) {
    if (node.visible === false) return;
    const fill = (node.fills || []).find((paint) => paint.visible !== false && paint.type === "IMAGE");
    if (fill?.imageRef && node.children?.length) out.push({ nodeId: `${node.id}:image-fill`, sourceNodeId: node.id, name: `${node.name || node.id} image fill`, imageRef: fill.imageRef, type: "image", exportMode: "source-image" });
    for (const child of node.children || []) walk(child);
  })(root);
  return out;
}

export function preserveFigma(root, metadata = {}) {
  const nodes = {};
  const frames = [];
  function walk(node, parentId, hidden) {
    if (!node || typeof node.id !== "string") throw new Error("Figma nodes require a source id");
    if (nodes[node.id]) throw new Error(`Duplicate Figma source id ${node.id}`);
    nodes[node.id] = preservedNode(node, parentId);
    nodes[node.id].effectiveVisible = !hidden && node.visible !== false;
    if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)) frames.push({ nodeId: node.id, parentId, name: node.name, bounds: copy(node.absoluteBoundingBox || null), componentId: node.componentId || null });
    for (const child of node.children || []) walk(child, node.id, hidden || node.visible === false);
  }
  walk(root, null, false);
  return { version: 1, rootId: root.id, sourceHash: createHash("sha256").update(JSON.stringify(root)).digest("hex"), frames, metadata: copy(metadata), nodes };
}

export function figmaColor(color, opacity = 1) {
  if (!color || ![color.r, color.g, color.b].every(finite)) return undefined;
  const hex = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0").toUpperCase();
  const alpha = (color.a ?? 1) * opacity;
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${alpha < 1 ? hex(alpha) : ""}`;
}

function measuredTypography(node) {
  const style = node.style || {};
  const out = {};
  for (const key of ["fontFamily", "fontSize", "fontWeight"]) if (style[key] !== undefined) out[key] = style[key];
  if (style.lineHeightUnit === "PIXELS" && finite(style.lineHeightPx)) out.lineHeight = `${style.lineHeightPx}px`;
  else if (style.lineHeightUnit === "FONT_SIZE_%" && finite(style.lineHeightPercentFontSize)) out.lineHeight = `${style.lineHeightPercentFontSize}%`;
  else if (finite(style.lineHeightPx)) out.lineHeight = `${style.lineHeightPx}px`;
  if (finite(style.letterSpacing)) out.letterSpacing = `${style.letterSpacing}px`;
  const align = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" }[style.textAlignHorizontal];
  if (align) out.align = align;
  const transform = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" }[style.textCase];
  if (transform) out.textTransform = transform;
  const paint = (node.fills || []).find((fill) => fill.visible !== false);
  if (paint?.type === "SOLID") out.color = figmaColor(paint.color, paint.opacity ?? 1);
  const gradient = resolveLinearGradient(paint, node.absoluteBoundingBox, 1);
  if (gradient) out.colorGradient = gradient;
  return out;
}

function measuredStyle(target, source, report) {
  const visibleText = (node) => node.visible === false ? null : node.type === "TEXT" ? node : (node.children || []).map(visibleText).find(Boolean);
  const textSource = source.type === "TEXT" ? source : target.type === "button" ? visibleText(source) : null;
  if (textSource) {
    // Figma TEXT fills color the glyphs. A stale AI background must not turn
    // white text into a white rectangle inside a protected native component.
    if (source.type === 'TEXT') delete target.background;
    target.text = textSource.characters ?? "";
    target.typography = measuredTypography(textSource);
    if (!Object.keys(target.typography).length) delete target.typography;
    if (textSource.characterStyleOverrides?.some((value) => value !== 0)) report.warnings.push(`${textSource.id}: mixed text runs preserved in figma.styleOverrideTable; a single native text style cannot reproduce every run`);
  }
  if (["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode)) {
    const layout = target.layout = { ...(target.layout || {}) };
    layout.display = source.layoutMode === "GRID" ? "grid" : "flex";
    if (source.layoutMode !== "GRID") {
      layout.direction = source.layoutMode === "HORIZONTAL" ? "row" : "column";
      const align = { MIN: "start", CENTER: "center", MAX: "end", STRETCH: "stretch" }[source.counterAxisAlignItems];
      const justify = { MIN: "start", CENTER: "center", MAX: "end", SPACE_BETWEEN: "space-between" }[source.primaryAxisAlignItems];
      if (align) layout.align = align;
      if (justify) layout.justify = justify;
      if (finite(source.itemSpacing)) {
        delete layout.gap; delete layout.rowGap; delete layout.columnGap;
        if (source.itemSpacing >= 0) layout.gap = source.itemSpacing;
        else report.warnings.push(`${source.id}: negative Auto Layout gap retained in figma.itemSpacing; CSS flex gaps cannot be negative`);
      }
      if (source.layoutWrap !== undefined) layout.wrap = source.layoutWrap === "WRAP";
      if (finite(source.counterAxisSpacing) && source.counterAxisSpacing >= 0) layout[source.layoutMode === "HORIZONTAL" ? "rowGap" : "columnGap"] = source.counterAxisSpacing;
    } else {
      if (Number.isInteger(source.gridColumnCount) && source.gridColumnCount > 0) layout.gridColumns = source.gridColumnCount;
      if (finite(source.gridColumnGap) && source.gridColumnGap >= 0) layout.gridGap = source.gridColumnGap;
      if (finite(source.gridRowGap) && source.gridRowGap >= 0) layout.gridRowGap = source.gridRowGap;
    }
    const padding = {};
    for (const side of ["top", "right", "bottom", "left"]) { const value = source[`padding${side[0].toUpperCase()}${side.slice(1)}`]; if (finite(value)) padding[side] = value; }
    if (Object.keys(padding).length) layout.padding = padding;
  }
  const size = target.size = { ...(target.size || {}) };
  for (const [axis, field, length] of [["Horizontal", "width", "width"], ["Vertical", "height", "height"]]) {
    const mode = source[`layoutSizing${axis}`];
    if (mode === "FILL") size[field] = "fill";
    else if (mode === "HUG") size[field] = "hug";
    else if (mode === "FIXED" && finite(source.absoluteBoundingBox?.[length])) size[field] = source.absoluteBoundingBox[length];
  }
  // Non-Auto-Layout frames still have an authoritative measured width. Without
  // it, flex-start wrappers shrink around text while retaining inferred padding.
  if(source.type==='FRAME'&&!source.layoutSizingHorizontal&&finite(source.absoluteBoundingBox?.width))size.width=source.absoluteBoundingBox.width;
  if(source.type==='TEXT'&&(source.textAutoResize||source.style?.textAutoResize)==='HEIGHT'&&finite(source.absoluteBoundingBox?.width))size.width=source.absoluteBoundingBox.width;
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) if (finite(source[key])) size[key] = source[key];
  if (!Object.keys(size).length) delete target.size;
  const fill = (source.fills || []).find((paint) => paint.visible !== false);
  if (source.type !== "TEXT" && target.type !== "image" && target.type !== "icon") {
    if (fill?.type === "SOLID") target.background = { color: figmaColor(fill.color, fill.opacity ?? 1) };
    const gradient = resolveLinearGradient(fill, source.absoluteBoundingBox, 1);
    if (gradient) target.background = { gradient };
  }
  const border = { ...(target.border || {}) };
  if (finite(source.cornerRadius)) border.radius = source.cornerRadius;
  if (Array.isArray(source.rectangleCornerRadii) && source.rectangleCornerRadii.length === 4) border.radii = { topLeft: source.rectangleCornerRadii[0], topRight: source.rectangleCornerRadii[1], bottomRight: source.rectangleCornerRadii[2], bottomLeft: source.rectangleCornerRadii[3] };
  const stroke = (source.strokes || []).find((paint) => paint.visible !== false);
  if (stroke?.type === "SOLID" && finite(source.strokeWeight)) { border.color = figmaColor(stroke.color, stroke.opacity ?? 1); border.width = source.strokeWeight; }
  if (Object.keys(border).length) target.border = border;
  const shadows = (source.effects || []).filter((effect) => effect.visible !== false && effect.type === "DROP_SHADOW");
  if (shadows.length === 1) {
    const shadow = shadows[0];
    if (finite(shadow.radius) && finite(shadow.offset?.x) && finite(shadow.offset?.y)) target.boxShadow = { color: figmaColor(shadow.color), blur: shadow.radius, offsetX: shadow.offset.x, offsetY: shadow.offset.y, spread: shadow.spread ?? 0 };
  }
  if (shadows.length > 1) report.warnings.push(`${source.id}: multiple shadows preserved in figma.effects; native single-shadow mapping is insufficient`);
  if ((source.effects || []).some((effect) => effect.visible !== false && !["DROP_SHADOW"].includes(effect.type))) report.warnings.push(`${source.id}: non-drop-shadow effects preserved in figma.effects for explicit handling`);
  if ((source.fills || []).filter((paint) => paint.visible !== false).length > 1) report.warnings.push(`${source.id}: stacked paints preserved in figma.fills; a single native background may not express the stack`);
  if (source.isMask) report.warnings.push(`${source.id}: mask preserved in source metadata; rectangular clipping is not an equivalent arbitrary mask`);
}

/** Reapply only authoritative raw values after legacy geometric reconstruction. */
export function reconcileFigmaProperties(doc, root, { manifest = [], metadata = {} } = {}) {
  const preserved = preserveFigma(root, metadata);
  const raw = new Map();
  (function index(node) { raw.set(node.id, node); for (const child of node.children || []) index(child); })(root);
  const report = { version: 1, sourceHash: preserved.sourceHash, warnings: [], nodes: [] };
  const represented = new Map();
  const assetIndex = new Map(manifest.map((asset) => [asset.nodeId, asset]));
  function walk(node) {
    const source = raw.get(node.figmaNodeId || node.asset?.nodeId);
    if (source) {
      if(node.children?.length && assetIndex.has(source.id) && isGraphicNode(source).composite){
        node.type='image';node.asset={nodeId:source.id,kind:'image'};delete node.children;
        node.layout={};node.size={width:source.absoluteBoundingBox.width,height:source.absoluteBoundingBox.height};
        if(node.figma){delete node.figma.geometryPositioned;delete node.figma.geometryLayered;}
        delete node.background;delete node.border;
      }
      represented.set(source.id, node);
      const derived = node.figma?.geometryDerived ? { geometryDerived: true, ...(node.figma.position ? { position: copy(node.figma.position) } : {}), ...(node.figma.geometryPositioned ? { geometryPositioned: true } : {}), ...(node.figma.geometryLayered ? { geometryLayered: true } : {}), ...(node.figma.paintSourceIds ? { paintSourceIds: copy(node.figma.paintSourceIds) } : {}) } : {};
      node.figma = { ...copy(preserved.nodes[source.id]), ...derived };
      // Figma crops a masked export to the painted children, excluding the mask's
      // wider box. Using the group box stretches that crop and breaks overlaps.
      if (node.asset && source.children?.some(c => c.isMask)) {
        const boxes = source.children.filter(c => !c.isMask && c.visible !== false).map(c => c.absoluteRenderBounds).filter(Boolean);
        if (boxes.length) {
          const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
          node.figma.exportBounds = { x, y, width: Math.max(...boxes.map(b => b.x+b.width))-x, height: Math.max(...boxes.map(b => b.y+b.height))-y };
        }
      }
      const fillSource = assetIndex.get(`${source.id}:image-fill`);
      if (fillSource?.exportMode === "source-image") node.figma.imageFillAsset = { nodeId: fillSource.nodeId, exportMode: fillSource.exportMode };
      measuredStyle(node, source, report);
      // A source-only photograph excludes its Figma paint overlay. Bricks'
      // image and gradient controls both write background-image, so place the
      // gradient on our existing overlay layer rather than let one erase the other.
      const paints=(source.fills||[]).filter(p=>p.visible!==false);
      if(node.figma.imageFillAsset?.exportMode==='source-image'&&paints.length===2&&paints.some(p=>p.type==='IMAGE')&&paints.some(p=>p.type==='GRADIENT_LINEAR')&&paints.every(p=>!p.blendMode||p.blendMode==='NORMAL')){
        const gradient=resolveLinearGradient(paints.find(p=>p.type==='GRADIENT_LINEAR'),source.absoluteBoundingBox,1);
        if(gradient){
          node._overlay=gradient;node._layered=true;delete node.background?.gradient;
          if(node.background&&!Object.keys(node.background).length)delete node.background;
          report.warnings=report.warnings.filter(w=>w!==`${source.id}: stacked paints preserved in figma.fills; a single native background may not express the stack`);
        }
      }
      const originalParent = raw.get(preserved.nodes[source.id].parentId);
      if (["HORIZONTAL", "VERTICAL", "GRID"].includes(originalParent?.layoutMode) && source.layoutPositioning !== "ABSOLUTE" && node.layout?.margin) {
        // Figma Auto Layout already contains alignment and padding. Geometry-derived offsets would apply them twice.
        delete node.layout.margin;
        if (!Object.keys(node.layout).length) delete node.layout;
      }
      if (source.layoutPositioning === "ABSOLUTE" && source.absoluteBoundingBox && preserved.nodes[source.id].parentId) {
        const parent = raw.get(preserved.nodes[source.id].parentId);
        if (parent?.absoluteBoundingBox) node.figma.position = { mode: "absolute", left: source.absoluteBoundingBox.x - parent.absoluteBoundingBox.x, top: source.absoluteBoundingBox.y - parent.absoluteBoundingBox.y };
      }
    }
    for (const child of node.children || []) walk(child);
  }
  walk(doc);
  const exported = new Set(manifest.map((asset) => asset.nodeId));
  const paintSources = new Map();
  for (const [ownerId, owner] of represented) for (const id of owner.figma?.paintSourceIds || []) paintSources.set(id, ownerId);
  for (const [id, info] of Object.entries(preserved.nodes)) {
    let owner = info.parentId;
    let exportedOwner = null;
    let textOwner = null;
    while (owner) {
      if (exported.has(owner) && represented.has(owner)) { exportedOwner = owner; break; }
      if (info.type === "TEXT" && represented.get(owner)?.type === "button" && represented.get(owner).text === info.characters) textOwner = owner;
      owner = preserved.nodes[owner]?.parentId;
    }
    const paintOwner = paintSources.get(id);
    const status = !info.effectiveVisible ? "hidden" : represented.has(id) ? "represented" : exportedOwner ? "covered-by-export" : textOwner ? "button-label" : paintOwner ? "absorbed-paint" : "unrepresented";
    report.nodes.push({ nodeId: id, parentId: info.parentId, name: info.name, type: info.type, status, ...(exportedOwner || textOwner || paintOwner ? { representedBy: exportedOwner || textOwner || paintOwner } : {}) });
  }
  report.summary = Object.fromEntries(["represented", "covered-by-export", "button-label", "absorbed-paint", "hidden", "unrepresented"].map((status) => [status, report.nodes.filter((node) => node.status === status).length]));
  report.warnings = [...new Set(report.warnings)];
  return { preserved, report };
}

const ICON_MAX_PX = 64;
/** Artwork, not content: nothing in it carries copy or an action. */
const hasCopy = (node) => node.type === "button" || (typeof node.text === "string" && node.text.length > 0) || (node.children || []).some(hasCopy);
const decorative = (node) => !hasCopy(node) && (["image", "icon"].includes(node.type) || (node.children?.length > 0 && node.children.every(decorative)) || (!node.children?.length && !!node.size));
let FLOW_TOL = 1; // px: boxes closer than this on an axis count as touching, not overlapping (relaxed for the second attempt)

/** A small framed label that is really a button: one text, a fill or stroke, rounded, button-sized (or named like one). */
export function buttonLike(source, visible) {
  if (!["FRAME", "INSTANCE", "COMPONENT", "GROUP"].includes(source.type)) return null;
  const box = source.absoluteBoundingBox;
  if (!box || box.height > 96 || box.width > 460 || box.height < 16) return null;
  const texts = visible.filter((child) => child.type === "TEXT");
  const others = visible.filter((child) => child.type !== "TEXT");
  if (texts.length !== 1 || !texts[0].characters?.trim() || texts[0].characters.length > 40) return null;
  const covers = (child) => child.type === "RECTANGLE" && !child.children?.length && child.absoluteBoundingBox
    && Math.abs(child.absoluteBoundingBox.width - box.width) <= 1 && Math.abs(child.absoluteBoundingBox.height - box.height) <= 1;
  if (others.length > 1 || others.some((child) => !covers(child))) return null;
  const painted = (node) => (node.fills || []).some((fill) => fill.visible !== false && (fill.type === "SOLID" || String(fill.type).startsWith("GRADIENT")))
    || (node.strokes || []).some((stroke) => stroke.visible !== false);
  const named = /(^|[^a-z])(button|btn|cta)([^a-z]|$)/i.test(source.name || "");
  const rounded = source.cornerRadius > 0 || (Array.isArray(source.rectangleCornerRadii) && source.rectangleCornerRadii.some((r) => r > 0));
  if (!(named || ((rounded || source.layoutMode === "HORIZONTAL") && (painted(source) || others.some(painted))))) return null;
  return texts[0];
}

/** Sort boxes into groups that overlap on one axis; groups are disjoint on that axis. */
function clusterBy(items, axis) {
  const length = axis === "y" ? "height" : "width";
  const sorted = [...items].sort((a, b) => a.box[axis] - b.box[axis] || a.box[length] - b.box[length]);
  const groups = [];
  let end = -Infinity;
  for (const item of sorted) {
    if (groups.length && item.box[axis] < end - FLOW_TOL) { groups.at(-1).push(item); end = Math.max(end, item.box[axis] + item.box[length]); }
    else { groups.push([item]); end = item.box[axis] + item.box[length]; }
  }
  return groups;
}
const unionBox = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

/**
 * XY-cut: turn loose (non Auto Layout) boxes into nested rows/columns from their measured positions, so they flow and reflow
 * instead of being pinned with left/top pixels. Returns null when boxes truly overlap on both axes (real layering).
 */
function xyCut(items, makeWrapper) {
  if (items.length < 2) return { dir: "column", items };
  for (const axis of ["y", "x"]) {
    const groups = clusterBy(items, axis);
    if (groups.length < 2) continue;
    const out = [];
    for (const group of groups) {
      if (group.length === 1) { out.push(group[0]); continue; }
      const inner = xyCut(group, makeWrapper);
      if (!inner) return null;
      out.push(makeWrapper(inner));
    }
    return { dir: axis === "y" ? "column" : "row", items: out };
  }
  return null;
}

/** Flex layout for one arranged group: uniform gap, cross-axis alignment, and margins only where the measured spacing is uneven. */
function flowLayout(dir, items) {
  const main = dir === "row" ? "x" : "y", mainLen = dir === "row" ? "width" : "height";
  const cross = dir === "row" ? "y" : "x", crossLen = dir === "row" ? "height" : "width";
  const mainSide = dir === "row" ? "left" : "top", crossSide = dir === "row" ? "top" : "left";
  const layout = { display: "flex", direction: dir };
  const gaps = items.slice(1).map((item, i) => item.box[main] - items[i].box[main] - items[i].box[mainLen]);
  if (gaps.length && gaps.every((gap) => Math.abs(gap - gaps[0]) <= 0.5)) layout.gap = Math.max(0, Math.round(gaps[0] * 100) / 100);
  else items.forEach((item, i) => { if (i && gaps[i - 1] > 0.5) item.node.layout = { ...(item.node.layout || {}), margin: { ...(item.node.layout?.margin || {}), [mainSide]: Math.round(gaps[i - 1] * 100) / 100 } }; });
  const lo = Math.min(...items.map((i) => i.box[cross])), hi = Math.max(...items.map((i) => i.box[cross] + i.box[crossLen]));
  const all = (fn) => items.every((item) => Math.abs(fn(item.box)) <= FLOW_TOL);
  if (all((b) => b[cross] - lo)) layout.align = "start";
  else if (all((b) => b[cross] + b[crossLen] / 2 - (lo + hi) / 2)) layout.align = "center";
  else if (all((b) => b[cross] + b[crossLen] - hi)) layout.align = "end";
  else {
    layout.align = "start";
    for (const item of items) { const offset = item.box[cross] - lo; if (offset > 0.5) item.node.layout = { ...(item.node.layout || {}), margin: { ...(item.node.layout?.margin || {}), [crossSide]: Math.round(offset * 100) / 100 } }; }
  }
  return layout;
}

/** Stable geometry/hierarchy conversion; semantics can be enriched later without rewriting measurements. */
export function deterministicNormalize(root, manifest = [], { metadata = {}, frameWidth = 0, siteWidth = 0 } = {}) {
  const assets = new Map(manifest.map((asset) => [asset.nodeId, asset]));
  const sourceNodes=new Map();(function index(n){sourceNodes.set(n.id,n);for(const c of n.children||[])index(c);})(root);
  const notes = [];
  const slug = (node) => `${String(node.name || node.type || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35).replace(/-$/, "") || "node"}-${createHash("sha256").update(node.id).digest("hex").slice(0, 8)}`;
  function convert(source, parent, section = false) {
    if (source.visible === false) return null; // Retained, with hidden descendants, in figma-preserved.json and coverage.
    const asset = assets.get(source.id);
    const base = { id: slug(source), figmaNodeId: source.id };
    if (source.type === "TEXT") return { ...base, type: "text", text: source.characters ?? "" };
    const solidStroke = (source.strokes || []).find((stroke) => stroke.visible !== false && stroke.type === "SOLID");
    const horizontalLine = source.type === "LINE" && source.absoluteBoundingBox?.height === 0 && source.absoluteBoundingBox?.width > 0;
    const verticalLine = source.type === "LINE" && source.absoluteBoundingBox?.width === 0 && source.absoluteBoundingBox?.height > 0;
    if ((horizontalLine || verticalLine) && solidStroke && finite(source.strokeWeight) && source.strokeWeight > 0) return {
      ...base, type: "spacer", size: { width: source.absoluteBoundingBox.width, height: source.absoluteBoundingBox.height },
      border: { color: figmaColor(solidStroke.color, solidStroke.opacity ?? 1), width: source.strokeWeight, sides: [horizontalLine ? "top" : "left"] }
    };
    if (!section && asset && (hasImageFill(source) && !source.children?.length || isGraphicNode(source).isGraphic)) {
      const box = source.absoluteBoundingBox;
      // Small vector graphics are icons (editable Bricks Icon element); photos and large artwork stay images.
      const isIcon = asset.type === "svg" && box && Math.max(box.width, box.height) <= ICON_MAX_PX;
      return { ...base, type: isIcon ? "icon" : "image", asset: { nodeId: source.id, kind: asset.type === "svg" ? "svg" : "image" }, ...(box ? { size: { width: box.width, height: box.height } } : {}) };
    }
    // A graphic with no export must not cost the whole section. Report it and keep the surrounding structure (and any children) instead.
    if (!section && (hasImageFill(source) && !source.children?.length || isGraphicNode(source).isGraphic) && !asset) {
      if (isGraphicNode(source).masked) throw new Error(`Required export missing for ${source.id}: complete mask composition`);
      notes.push(`${source.id} (${source.name}): graphic has no exported file - re-run extraction; its box is kept as an empty block`);
      const box = source.absoluteBoundingBox;
      // Do not descend: the vectors inside an un-exported graphic would each become an empty, pinned block.
      return { ...base, type: "block", ...(box ? { size: { width: box.width, height: box.height } } : {}) };
    }
    let visible = (source.children || []).filter((child) => child.visible !== false);
    if(!source._inferredPanel){
      const rectangles=visible.filter(n=>n.type==='RECTANGLE'&&!n.isMask&&n.absoluteBoundingBox?.width>120&&n.absoluteBoundingBox?.height>80&&(n.fills||[]).some(f=>f.visible!==false&&f.type==='SOLID'));
      const repeated=rectangles.filter(a=>rectangles.some(b=>a!==b&&Math.abs(a.absoluteBoundingBox.width-b.absoluteBoundingBox.width)<2&&Math.abs(a.absoluteBoundingBox.height-b.absoluteBoundingBox.height)<2));
      const owned=new Set(),panels=new Map();
      for(const rect of repeated){
        const b=rect.absoluteBoundingBox;
        const inside=visible.filter(n=>n!==rect&&!owned.has(n.id)&&!repeated.includes(n)&&n.absoluteBoundingBox&&n.absoluteBoundingBox.x>=b.x-1&&n.absoluteBoundingBox.y>=b.y-1&&n.absoluteBoundingBox.x+n.absoluteBoundingBox.width<=b.x+b.width+1&&n.absoluteBoundingBox.y+n.absoluteBoundingBox.height<=b.y+b.height+1);
        if(inside.length<2||!inside.some(n=>n.type==='TEXT'))continue;
        const panel={id:`${rect.id}-panel`,name:'Measured card panel',type:'GROUP',_inferredPanel:true,absoluteBoundingBox:b,children:[rect,...inside]};
        sourceNodes.set(panel.id,panel);panels.set(rect.id,panel);inside.forEach(n=>owned.add(n.id));
      }
      if(panels.size)visible=visible.filter(n=>!owned.has(n.id)).map(n=>panels.get(n.id)||n);
    }
    const labelText = !section && !asset ? buttonLike(source, visible) : null;
    if (labelText) {
      const box = source.absoluteBoundingBox, tb = labelText.absoluteBoundingBox;
      const button = { ...base, type: "button", text: labelText.characters };
      // Loose (non Auto Layout) buttons: padding is the measured distance from the frame edge to the label.
      if (!source.layoutMode || source.layoutMode === "NONE") {
        if (tb) button.layout = { padding: { top: Math.max(0, Math.round(tb.y - box.y)), right: Math.max(0, Math.round(box.x + box.width - tb.x - tb.width)), bottom: Math.max(0, Math.round(box.y + box.height - tb.y - tb.height)), left: Math.max(0, Math.round(tb.x - box.x)) } };
      }
      return button;
    }
    const first = visible[0];
    const parentBox = source.absoluteBoundingBox;
    const firstBox = first?.absoluteBoundingBox;
    const firstPaint = (first?.fills || []).find((fill) => fill.visible !== false);
    const ownPaint = (source.fills || []).find((fill) => fill.visible !== false);
    const covers = parentBox && firstBox && Math.abs(firstBox.x - parentBox.x) <= 0.5 && Math.abs(firstBox.y - parentBox.y) <= 0.5 && Math.abs(firstBox.width - parentBox.width) <= 0.5 && Math.abs(firstBox.height - parentBox.height) <= 0.5;
    const background = !ownPaint && first?.type === "RECTANGLE" && !first.children?.length && !first.isMask && covers && (firstPaint?.type === "SOLID" || resolveLinearGradient(firstPaint, firstBox, 1)) && (!source.layoutMode || source.layoutMode === "NONE" || first.layoutPositioning === "ABSOLUTE") ? first : null;
    const children = visible.filter((child) => child !== background);
    const kids = children.map((child) => convert(child, source)).filter(Boolean);
    const auto = source.layoutMode === "HORIZONTAL" ? "row" : source.layoutMode === "VERTICAL" ? "column" : null;
    const flowSources = children.filter((child) => child.layoutPositioning !== "ABSOLUTE");
    const bounds = flowSources.map((child) => child.absoluteBoundingBox);
    // Loose children are cut into nested rows/columns from their measured boxes (see xyCut) rather than pinned with left/top.
    let arranged = null, wrapperCount = 0, layers = [];
    const kidOf = new Map(kids.map((kid) => [kid.figmaNodeId, kid]));
    if (!auto && flowSources.length && bounds.every(Boolean) && flowSources.every((child) => kidOf.has(child.id))) {
      const makeWrapper = (inner) => {
        const node = { id: `${base.id}-g${++wrapperCount}`, type: inner.dir, children: inner.items.map((item) => item.node), layout: flowLayout(inner.dir, inner.items) };
        return { box: unionBox(inner.items.map((item) => item.box)), node };
      };
      let flowItems = flowSources.map((child) => ({ box: child.absoluteBoundingBox, node: kidOf.get(child.id) }));
      arranged = xyCut(flowItems, makeWrapper);
      // Artwork lying behind the content (banner/hero backdrops) overlaps everything and blocks the cut: pin it behind the content and
      // cut the rest again. Only real backdrops qualify - big enough to cover most of the group, or enclosing another item. A card
      // picture that merely touches its title is content, not a backdrop.
      const area = (item) => item.box.width * item.box.height;
      const groupBox = unionBox(flowItems.map((item) => item.box));
      const encloses = (a, b) => b.box.x >= a.box.x - 2 && b.box.y >= a.box.y - 2 && b.box.x + b.box.width <= a.box.x + a.box.width + 2 && b.box.y + b.box.height <= a.box.y + a.box.height + 2;
      const backdrop = (item) => decorative(item.node) && (area(item) >= 0.6 * groupBox.width * groupBox.height || flowItems.some((o) => o !== item && encloses(item, o)));
      while (!arranged && flowItems.length > 1) {
        const layer = flowItems.filter(backdrop).sort((a, b) => area(b) - area(a))[0];
        if (!layer) break;
        flowItems = flowItems.filter((item) => item !== layer);
        layers.push(layer);
        arranged = xyCut(flowItems, makeWrapper);
      }
      // An unpainted Figma GROUP may span a neighbouring heading even though
      // its actual children do not overlap. Expand only such grouping boxes
      // before resorting to absolute positioning of the entire section.
      const nodeBox=node=>sourceNodes.get(node.figmaNodeId)?.absoluteBoundingBox||((node.children||[]).length&&node.children.every(c=>nodeBox(c))?unionBox(node.children.map(nodeBox)):null);
      for(let pass=0;!arranged&&pass<4;pass++){
        const candidate=flowItems.find(item=>{
          const raw=sourceNodes.get(item.node.figmaNodeId);
          return (raw?.type==='GROUP'||!raw&&!item.node.figmaNodeId)&&item.node.children?.length&&!raw?.fills?.some(p=>p.visible!==false)&&!raw?.strokes?.some(p=>p.visible!==false)&&!raw?.effects?.some(p=>p.visible!==false)&&!raw?.reactions?.length&&item.node.children.every(c=>nodeBox(c))&&flowItems.some(other=>other!==item&&Math.min(item.box.x+item.box.width,other.box.x+other.box.width)-Math.max(item.box.x,other.box.x)>1&&Math.min(item.box.y+item.box.height,other.box.y+other.box.height)-Math.max(item.box.y,other.box.y)>1);
        });
        if(!candidate)break;
        const expanded=candidate.node.children.map(original=>{
          const node=copy(original);
          if(node.figma?.geometryDerived)delete node.figma.position;
          if(node.layout?.margin)delete node.layout.margin;
          return {node,box:nodeBox(node)};
        });
        flowItems=flowItems.flatMap(item=>item===candidate?expanded:[item]);
        arranged=xyCut(flowItems,makeWrapper);
      }
      if (!arranged) {
        // Slight overlaps (a title sitting a few px over its picture, shadows, rounding) stay in the flow instead of being pinned.
        layers = []; flowItems = flowSources.map((child) => ({ box: child.absoluteBoundingBox, node: kidOf.get(child.id) }));
        FLOW_TOL = Math.max(24, Math.min(...flowItems.map((item) => Math.min(item.box.width, item.box.height))) * 0.2);
        try { arranged = xyCut(flowItems, makeWrapper); } finally { FLOW_TOL = 1; }
      }
      if (!arranged) layers = [];
    }
    for (const layer of layers) layer.node.figma = { ...(layer.node.figma || {}), geometryDerived: true, position: { mode: "absolute", left: layer.box.x - parentBox.x, top: layer.box.y - parentBox.y, behind: true } };
    const measuredDirection = arranged?.dir ?? null;
    // Carousel evidence: three or more equal slides in one row that run past the page (a Figma slider lays its slides side by side,
    // most of them off-canvas). A row of cards that fits the page stays a plain row/grid.
    let componentTag = null;
    if (!section && frameWidth && arranged?.dir === "row" && arranged.items.length >= 3 && parentBox) {
      const widths = arranged.items.map((item) => item.box.width), heights = arranged.items.map((item) => item.box.height);
      const equal = Math.max(...widths) - Math.min(...widths) <= 2 && Math.max(...heights) - Math.min(...heights) <= 2;
      if (equal && parentBox.width > frameWidth * 1.3) {
        const gaps = arranged.items.slice(1).map((item, i) => item.box.x - arranged.items[i].box.x - arranged.items[i].box.width);
          componentTag = { kind: "slider", options: { slidesPerView: 1, gap: Math.max(0, Math.round(gaps[0] || 0)) } };
          notes.push(`${source.id}: ${arranged.items.length} equal slides side by side past the page width -> native slider; controls require separate design evidence`);
      }
    }
    const type = section ? "section" : auto || measuredDirection || "block";
    const absoluteKids = kids.filter((kid) => !flowSources.some((child) => child.id === kid.figmaNodeId));
    const outKids = arranged ? [...layers.map((item) => item.node), ...arranged.items.map((item) => item.node), ...absoluteKids] : kids;
    const out = { ...base, type, ...(outKids.length ? { children: outKids } : {}), ...(componentTag ? { component: componentTag } : {}) };
    if (background) {
      out.figma = { geometryDerived: true, paintSourceIds: [background.id] };
      measuredStyle(out, background, { warnings: [] });
      // A section background does not define content width. A card-sized
      // background does: preserve its measured box so repeated cards remain
      // equal before the responsive pass turns that width into a fluid max.
      if(section)delete out.size;
      else if(parentBox)out.size={width:parentBox.width,minHeight:parentBox.height};
    }
    if (layers.length) out.figma = { ...(out.figma || {}), geometryDerived: true, geometryLayered: true };
    if (!auto && measuredDirection) {
      const layout = out.layout = flowLayout(measuredDirection, arranged.items);
      if (parentBox && bounds.every(Boolean)) {
        const content = arranged.items.map((item) => item.box); // pinned backdrops do not count as content
        const left = Math.min(...content.map((value) => value.x)), top = Math.min(...content.map((value) => value.y));
        const right = Math.max(...content.map((value) => value.x + value.width)), bottom = Math.max(...content.map((value) => value.y + value.height));
        layout.padding = { top: Math.max(0, top - parentBox.y), right: Math.max(0, parentBox.x + parentBox.width - right), bottom: Math.max(0, parentBox.y + parentBox.height - bottom), left: Math.max(0, left - parentBox.x) };
        // Extra trailing space around one auto-width text label is free space,
        // not a fixed inset that should squeeze the label on narrower screens.
        if (flowSources.length === 1 && flowSources[0].type === 'TEXT' && (flowSources[0].textAutoResize || flowSources[0].style?.textAutoResize) === 'WIDTH_AND_HEIGHT') {
          const { left, right } = layout.padding;
          if (Math.abs(left - right) <= 1) {
            layout.align = 'center';
            layout.padding.left = layout.padding.right = 0;
          } else if (right > left) layout.padding.right = left;
          else { layout.align = 'end'; layout.padding.left = right; }
        }
        // A wrapper as wide as the page already sits inside the centred site container: the page's side margin must not be applied twice.
        const margin = frameWidth && siteWidth && siteWidth < frameWidth ? (frameWidth - siteWidth) / 2 : 0;
        if (margin && parentBox.width >= frameWidth * 0.95) { layout.padding.left = Math.max(0, layout.padding.left - margin); layout.padding.right = Math.max(0, layout.padding.right - margin); }
      }
    }
    if (layers.length && parentBox) out.size = { ...(out.size || {}), minHeight: Math.round(parentBox.height) };
    const absolute = children.some((child) => child.layoutPositioning === "ABSOLUTE");
    if (source.absoluteBoundingBox && (absolute || !kids.length && source.type !== "TEXT")) out.size = { width: source.absoluteBoundingBox.width, height: source.absoluteBoundingBox.height };
    if (!auto && !measuredDirection && kids.length > 1) {
      out.figma = { ...(out.figma || {}), geometryDerived: true, geometryPositioned: true };
      // Keep source z-order and measured overlap. Absolute mode is used only within an explicit bounds-bearing wrapper.
      if (source.absoluteBoundingBox && bounds.every(Boolean)) {
        out.size = { width: source.absoluteBoundingBox.width, height: source.absoluteBoundingBox.height };
        for (const child of kids) {
          const original = children.find((entry) => entry.id === child.figmaNodeId);
          if (original?.absoluteBoundingBox) child.figma = { ...(child.figma || {}), geometryDerived: true, position: { mode: "absolute", left: original.absoluteBoundingBox.x - source.absoluteBoundingBox.x, top: original.absoluteBoundingBox.y - source.absoluteBoundingBox.y } };
        }
      } else notes.push(`${source.id}: overlapping or unmeasured loose children kept in Figma hierarchy; no geometry invented`);
    }
    return out;
  }
  const doc = { type: "page", children: [convert(root, null, true)] };
  const local = new Map();
  (function keep(node) { if (node.figma) local.set(node.figmaNodeId, copy(node.figma)); for (const child of node.children || []) keep(child); })(doc);
  const { preserved, report } = reconcileFigmaProperties(doc, root, { manifest, metadata });
  (function restore(node) { if (local.has(node.figmaNodeId)) node.figma = { ...node.figma, ...local.get(node.figmaNodeId) }; for (const child of node.children || []) restore(child); })(doc);
  if (notes.length) doc._uncertain = notes;
  return { doc, preserved, report };
}
