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
      represented.set(source.id, node);
      const derived = node.figma?.geometryDerived ? { geometryDerived: true, ...(node.figma.position ? { position: copy(node.figma.position) } : {}), ...(node.figma.geometryPositioned ? { geometryPositioned: true } : {}), ...(node.figma.paintSourceIds ? { paintSourceIds: copy(node.figma.paintSourceIds) } : {}) } : {};
      node.figma = { ...copy(preserved.nodes[source.id]), ...derived };
      const fillSource = assetIndex.get(`${source.id}:image-fill`);
      if (fillSource?.exportMode === "source-image") node.figma.imageFillAsset = { nodeId: fillSource.nodeId, exportMode: fillSource.exportMode };
      measuredStyle(node, source, report);
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

/** Stable geometry/hierarchy conversion; semantics can be enriched later without rewriting measurements. */
export function deterministicNormalize(root, manifest = [], { metadata = {} } = {}) {
  const assets = new Map(manifest.map((asset) => [asset.nodeId, asset]));
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
    if (!section && asset && (hasImageFill(source) && !source.children?.length || isGraphicNode(source).isGraphic)) return { ...base, type: "image", asset: { nodeId: source.id, kind: asset.type === "svg" ? "svg" : "image" }, ...(source.absoluteBoundingBox ? { size: { width: source.absoluteBoundingBox.width, height: source.absoluteBoundingBox.height } } : {}) };
    if (!section && (hasImageFill(source) && !source.children?.length || isGraphicNode(source).isGraphic) && !asset) throw new Error(`Required export missing for ${source.id} (${source.name}); deterministic normalization cannot discard this graphic`);
    const visible = (source.children || []).filter((child) => child.visible !== false);
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
    const separable = (axis, length) => bounds.length > 1 && bounds.every(Boolean) && bounds.every((box, index) => !index || box[axis] >= bounds[index - 1][axis] + bounds[index - 1][length] - 0.5);
    const measuredDirection = separable("y", "height") || bounds.length === 1 && bounds[0] ? "column" : separable("x", "width") ? "row" : null;
    const type = section ? "section" : auto || measuredDirection || "block";
    const out = { ...base, type, ...(kids.length ? { children: kids } : {}) };
    if (background) {
      out.figma = { geometryDerived: true, paintSourceIds: [background.id] };
      measuredStyle(out, background, { warnings: [] });
      delete out.size; // The background's source dimensions do not define the parent's responsive sizing.
    }
    if (!auto && measuredDirection) {
      const layout = out.layout = { display: "flex", direction: measuredDirection };
      const axis = measuredDirection === "row" ? "x" : "y";
      const length = measuredDirection === "row" ? "width" : "height";
      const side = measuredDirection === "row" ? "left" : "top";
      const gaps = bounds.slice(1).map((value, index) => value[axis] - bounds[index][axis] - bounds[index][length]);
      if (gaps.length && gaps.every((gap) => Math.abs(gap - gaps[0]) <= 0.5)) layout.gap = Math.max(0, gaps[0]);
      else for (let index = 1; index < bounds.length; index++) if (gaps[index - 1] > 0) {
        const child = kids.find((entry) => entry.figmaNodeId === flowSources[index].id);
        if (child) child.layout = { ...(child.layout || {}), margin: { [side]: gaps[index - 1] } };
      }
      if (parentBox && bounds.every(Boolean)) {
        const left = Math.min(...bounds.map((value) => value.x)), top = Math.min(...bounds.map((value) => value.y));
        const right = Math.max(...bounds.map((value) => value.x + value.width)), bottom = Math.max(...bounds.map((value) => value.y + value.height));
        layout.padding = { top: Math.max(0, top - parentBox.y), right: Math.max(0, parentBox.x + parentBox.width - right), bottom: Math.max(0, parentBox.y + parentBox.height - bottom), left: Math.max(0, left - parentBox.x) };
      }
    }
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
