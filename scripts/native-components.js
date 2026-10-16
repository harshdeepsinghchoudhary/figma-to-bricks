/** Conservative semantic recognition backed by the saved site's runtime schemas.
 * It does not call AI, alter WordPress, or infer destinations/submission actions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRICKS_BREAKPOINTS } from "./breakpoints.js";
import { findPanels } from "./decoration-detect.js";
import { figmaColor } from "./figma-preservation.js";
import { resolveLinearGradient } from "./gradient-utils.js";

const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema/runtime");
const NATIVE_NAMES = { navigation: "nav-nested", slider: "slider-nested", tabs: "tabs-nested", accordion: "accordion-nested", form: "form" };
const WRAPPERS = new Set(["section", "container", "row", "column", "block"]);
const TEXT = new Set(["heading", "text", "text-basic", "button"]);
const clone = value => JSON.parse(JSON.stringify(value));
const descendants = n => [n, ...(n.children || []).flatMap(descendants)];
const words = n => descendants(n).filter(c => TEXT.has(c.type)).map(c => c.text || "").join(" ");
const bare = value => value === undefined ? undefined : String(value);

export function runtimeElement(name, dir = runtimeDir) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const schema = JSON.parse(fs.readFileSync(file, "utf8"));
  return schema.name === name && schema.controls && !Array.isArray(schema.controls) ? schema : null;
}
export function runtimeKeys(name, dir = runtimeDir) { return new Set(Object.keys(runtimeElement(name, dir)?.controls || {})); }

/** Treat native subtrees as opaque during legacy layout simplification. Keep a
 * content-bearing block with a boundary note: unsupported sentinels are filtered
 * by legacy section rules. Descendant IDs remain visible to content coverage,
 * while all internal rewrites are replaced by the original native subtree.
 */
export function protectNativeStructures(input, transform) {
  const saved = new Map();
  function mask(n) {
    if (n._nativeName) { saved.set(n.id, clone(n)); return { ...clone(n), type: "block", notes: [...(n.notes || []), "Native component boundary"] }; }
    return { ...clone(n), ...(n.children ? { children: n.children.map(mask) } : {}) };
  }
  const result = transform(mask(input));
  const restored = new Set();
  function restore(n) {
    if (saved.has(n.id)) { restored.add(n.id); return clone(saved.get(n.id)); }
    return { ...n, ...(n.children ? { children: n.children.map(restore) } : {}) };
  }
  result.doc = restore(result.doc);
  const missing = [...saved.keys()].filter(id => !restored.has(id));
  if (missing.length) throw new Error(`Structure pass discarded native boundaries: ${missing.join(", ")}`);
  return result;
}

function indexFigma(root) {
  const nodes = new Map();
  (function walk(n, parent) { if (!n) return; if (n.id) nodes.set(n.id, { ...n, _parentId: parent }); for (const c of n.children || []) walk(c, n.id); })(root?.document || root);
  return nodes;
}
function native(n, name, settings = {}) { n._nativeName = name; n._nativeSettings = { ...(n._nativeSettings || {}), ...settings }; n._nativeLayoutLock = true; }
function classes(n, value) { n._nativeSettings = { ...(n._nativeSettings || {}), _hidden: { ...(n._nativeSettings?._hidden || {}), _cssClasses: [...new Set([...(n._nativeSettings?._hidden?._cssClasses || "").split(/\s+/), value].filter(Boolean))].join(" ") } }; }
function sourceName(n, nodes) { return [n.id, n.figma?.name, nodes.get(n.figmaNodeId)?.name].filter(Boolean).join(" "); }
function role(n, value, nodes) { return n.component?.role === value || new RegExp(`(^|[\\s_-])${value.replaceAll("-", "[\\s_-]*")}($|[\\s_-])`, "i").test(sourceName(n, nodes)); }
function linkFrom(n, nodes) {
  if (n.href) return n.href;
  const source = nodes.get(n.figmaNodeId);
  for (const reaction of source?.reactions || source?.prototypeInteractions || n.figma?.reactions || []) {
    for (const action of [...(reaction.actions || []), reaction.action].filter(Boolean)) if (action.type === "URL" && action.url) return action.url;
  }
  if (source?.hyperlink?.type === "URL") return source.hyperlink.url;
  return null;
}

function navigationLabel(n) {
  if (TEXT.has(n.type) && !(n.children || []).length) return n;
  // A highlighted menu item is often a hug frame around one label. Preserve its
  // padding/fill on the native link while avoiding cards with copy or media.
  if (!WRAPPERS.has(n.type)) return null;
  const content = descendants(n).slice(1), labels = content.filter(c => TEXT.has(c.type));
  return labels.length === 1 && content.every(c => WRAPPERS.has(c.type) || TEXT.has(c.type)) ? labels[0] : null;
}

function sourceBackground(n, nodes) {
  const color = source => {
    const fill = source?.fills?.find(paint => paint.visible !== false && paint.type === "SOLID" && paint.color && (paint.opacity ?? 1) > 0);
    if (!fill) return null;
    const hex = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
    const alpha = (fill.opacity ?? 1) * (fill.color.a ?? 1);
    return `#${[fill.color.r, fill.color.g, fill.color.b].map(hex).join("")}${alpha < 1 ? hex(alpha) : ""}`.toUpperCase();
  };
  let source = nodes.get(n.figmaNodeId);
  while (source) {
    const own = color(source); if (own) return own;
    const bounds = source.absoluteBoundingBox;
    const backdrop = (source.children || []).find(child => {
      const box = child.absoluteBoundingBox;
      return child.visible !== false && !(child.children || []).length && bounds && box && Math.abs(box.x - bounds.x) <= 1 && Math.abs(box.y - bounds.y) <= 1 && box.width >= bounds.width - 1 && box.height >= bounds.height - 1 && color(child);
    });
    if (backdrop) return color(backdrop);
    source = nodes.get(source._parentId);
  }
  return null;
}

function geometricNavigation(n, nodes, root) {
  const source = nodes.get(n.figmaNodeId), page = (root?.document || root)?.absoluteBoundingBox;
  const items = n.children || [], labels = items.map(navigationLabel);
  if (!page || page.width < 600 || !source?.absoluteBoundingBox || items.length < 3 || labels.some(label => !label || !label.text?.trim() || label.text.length > 48 || label.text.includes("\n") || (label.typography?.fontSize || 16) > 24)) return null;
  const boxes = items.map(item => nodes.get(item.figmaNodeId)?.absoluteBoundingBox || nodes.get(navigationLabel(item)?.figmaNodeId)?.absoluteBoundingBox);
  if (boxes.some(box => !box || box.height > 64) || Math.max(...boxes.map(box => box.y + box.height / 2)) - Math.min(...boxes.map(box => box.y + box.height / 2)) > 12 || boxes.some((box, i) => i && box.x < boxes[i - 1].x + boxes[i - 1].width - 1)) return null;
  // Require an actual wide, shallow header ancestor, rather than treating the
  // candidate row itself or a hero's first card row as a header band.
  let parent = nodes.get(source._parentId), band = null;
  while (parent) {
    const box = parent.absoluteBoundingBox;
    if (parent.id !== (root?.document || root)?.id && box && box.width >= page.width * 0.85 && box.height <= 160 && box.y - page.y >= -1 && box.y - page.y <= 128) { band = parent; break; }
    parent = nodes.get(parent._parentId);
  }
  if (!band) return null;
  const home = labels.some(label => /^home$/i.test(label.text.trim()));
  const destinations = items.filter((item, index) => linkFrom(item, nodes) || linkFrom(labels[index], nodes)).length;
  const logo = [...nodes.values()].some(node => { const box = node.absoluteBoundingBox; return box && box.y - page.y >= -1 && box.y - page.y <= 128 && /(^|[\s_-])(logo|brand)([\s_-]|$)/i.test([node.name, node.characters].filter(Boolean).join(" ")); });
  return home || (logo && destinations >= 2) ? { status: "native", reason: "aligned short labels inside a shallow page header, with Home or linked logo context" } : { status: "potential", reason: "aligned short header labels; navigation intent is uncertain without Home, links, or a semantic annotation" };
}

/** Called after measured structural reconciliation, before generic responsive rules.
 * Explicit component annotations are still checked for a valid content structure.
 */
export function recognizeComponents(input, { figmaRoot = null, schemaDir = runtimeDir } = {}) {
  const doc = clone(input), nodes = indexFigma(figmaRoot), report = [], decisions = [];
  const used = new Set(descendants(doc).map(n => n.id).filter(Boolean));
  const fresh = stem => { let id = stem, suffix = 1; while (used.has(id)) id = `${stem}-${suffix++}`; used.add(id); return id; };
  const wrapper = (stem, children, setting = {}) => ({ type: "block", id: fresh(stem), children, _nativeSettings: setting, _nativeLayoutLock: true });
  const decision = (n, kind, status, reason) => { decisions.push({ id: n.id, figmaNodeId: n.figmaNodeId, kind, status, reason }); report.push(`${n.id}: ${kind} ${status} (${reason})`); };
  const schema = name => runtimeElement(name, schemaDir);
  const markLink = n => {
    const label = navigationLabel(n);
    if (!label) return false;
    const href = linkFrom(n, nodes) || linkFrom(label, nodes);
    if (label !== n) {
      n.text = label.text; n.typography = label.typography || n.typography;
      n._absorbedSourceIds = [...(n._absorbedSourceIds || []), ...descendants(n).slice(1).map(child => child.figmaNodeId)].filter(Boolean);
      n.children = [];
    }
    native(n, "text-link", { text: label.text, ...(href ? { link: { type: "external", url: href, postId: "" } } : {}) });
    if (!href) report.push(`${n.id}: navigation destination absent from Figma; set the link in Bricks before publishing.`);
    return true;
  };

  function navItems(items) {
    return items.every(n => {
      if (markLink(n)) return true;
      if (role(n, "dropdown", nodes) || /\bdropdown\b/i.test(sourceName(n, nodes))) {
        const trigger = (n.children || []).find(c => TEXT.has(c.type));
        const content = (n.children || []).find(c => (c.children || []).length);
        if (!trigger || !content || !schema("dropdown") || !navItems(content.children)) return false;
        native(n, "dropdown", { text: trigger.text, ...(linkFrom(trigger, nodes) ? { link: { type: "external", url: linkFrom(trigger, nodes), postId: "" } } : {}) });
        // The native Dropdown renders its trigger itself; transfer its exact style.
        n.typography = trigger.typography || n.typography;
        n._absorbedSourceIds = [...(n._absorbedSourceIds || []), trigger.figmaNodeId].filter(Boolean);
        native(content, "div", { _hidden: { _cssClasses: "brx-dropdown-content" }, tag: "ul" });
        content._nativeFlags = { deletable: false, cloneable: false };
        n.children = [content];
        return true;
      }
      return false;
    });
  }

  function navigation(n, options, ancestors = []) {
    if (!schema("text-link") || !schema("toggle") || !schema("block")) return "required text-link/toggle/block schemas are unavailable";
    const original = clone(n);
    let items = n.children || [];
    if (items.length === 1 && WRAPPERS.has(items[0].type)) { const host = items[0]; items = host.children || []; }
    if (!items.length || !navItems(items)) { Object.keys(n).forEach(k => delete n[k]); Object.assign(n, original); return "navigation must contain short text links or verified dropdown subtrees"; }
    const nativeSchema = schema("nav-nested");
    const gap = options.gap ?? n.layout?.columnGap ?? n.layout?.gap;
    const widths = items.map(item => nodes.get(item.figmaNodeId)?.absoluteBoundingBox?.width || (typeof item.size?.width === "number" ? item.size.width : 0));
    const required = widths.every(width => width > 0) ? Math.ceil(widths.reduce((sum, width) => sum + width, 0) + (gap || 0) * (items.length - 1) + 32) : 0;
    const defaultWidth = BRICKS_BREAKPOINTS.variants.find(point => point.key === BRICKS_BREAKPOINTS.mobile)?.width || 0;
    let bp = options.mobileBreakpoint || BRICKS_BREAKPOINTS.mobile;
    let customWidth;
    if (!options.mobileBreakpoint && required > defaultWidth) {
      const fitting = [...BRICKS_BREAKPOINTS.variants].sort((a, b) => a.width - b.width).find(point => point.width >= required);
      if (fitting) bp = fitting.key;
      else if (nativeSchema.controls.mobileMenuCustomBreakpoint && nativeSchema.controls.mobileMenu?.options?.custom) { bp = "custom"; customWidth = required; }
      report.push(`${n.id}: mobile menu switches at ${customWidth || BRICKS_BREAKPOINTS.variants.find(point => point.key === bp)?.width}px to fit the measured link widths and gaps.`);
    }
    if (!nativeSchema.controls.mobileMenu?.options || !(bp in nativeSchema.controls.mobileMenu.options)) return `mobile breakpoint ${bp} is not supported by the saved navigation schema`;
    const menuPreset = nativeSchema.nestableChildren?.find(c => c.name === "block");
    const menu = wrapper(`${n.id}-items`, items, { ...(clone(menuPreset?.settings || {})), tag: "ul" });
    native(menu, "block", menu._nativeSettings);
    menu._nativeFlags = { deletable: false, cloneable: false };
    // Toggle settings are taken from canonical runtime nestableChildren below.
    const presets = descendants({ children: nativeSchema.nestableChildren || [] });
    const togglePresets = presets.filter(c => c.name === "toggle");
    if (togglePresets.length < 2) return "runtime navigation toggle presets are unavailable";
    const openPreset = togglePresets.find(c => /Open/i.test(c.label)), closePreset = togglePresets.find(c => /Close/i.test(c.label));
    if (!openPreset || !closePreset) return "runtime navigation open/close presets are ambiguous";
    const presetSettings = p => Array.isArray(p.settings) ? {} : clone(p.settings || {});
    const open = { type: "block", id: fresh(`${n.id}-open`), _nativeName: "toggle", _nativeSettings: presetSettings(openPreset), _nativeLayoutLock: true };
    const close = { type: "block", id: fresh(`${n.id}-close`), _nativeName: "toggle", _nativeSettings: presetSettings(closePreset), _nativeLayoutLock: true };
    menu.children.push(close);
    const mobileBackground = n.background?.color || [...ancestors].reverse().find(parent => parent.background?.color)?.background.color || sourceBackground(n, nodes);
    native(n, "nav-nested", { mobileMenu: bp, ...(customWidth ? { mobileMenuCustomBreakpoint: bare(customWidth) } : {}), ...(gap !== undefined ? { gap: bare(gap) } : {}), ...(options.ariaLabel ? { ariaLabel: options.ariaLabel } : {}), ...(mobileBackground ? { mobileMenuBackgroundColor: { raw: mobileBackground } } : {}) });
    // Native switching owns the root's intrinsic width; a desktop Figma box must
    // not keep its hamburger wrapper wider than the phone viewport.
    if (typeof n.size?.width === "number") { delete n.size.width; delete n.size.maxWidth; }
    n.children = [menu, open];
    return null;
  }

  function slider(n, options) {
    const childNodes = n.children || [], control = c => role(c, "controls", nodes) || role(c, "pagination", nodes) || /(^|[\s_-])(arrows?|pagination|dots?|next|previous)([\s_-]|$)/i.test(sourceName(c, nodes));
    let host = childNodes.find(c => (c.children || []).length >= 2 && (role(c, "menu", nodes) || /slides|track/i.test(sourceName(c, nodes))));
    const slides = (host ? host.children : childNodes).filter(c => !control(c));
    if (slides.length < 2 || slides.some(c => !(c.children || []).length && !["image", "text", "text-basic", "heading"].includes(c.type))) return "slider requires at least two identifiable slides";
    // A visual arrow/dot must not become an ordinary slide. Native controls replace only
    // recognized controls; anything unclassified remains visible as a separate sibling.
    const controls = childNodes.filter(control);
    const dotSources = [];
    function dotStrip(source) {
      if (!source) return false;
      if (source.children?.length === 1) return dotStrip(source.children[0]);
      const parts = (source.children || []).filter(c => c.visible !== false);
      const circular = c => c.type === 'ELLIPSE' || !!c.children?.length && c.children.every(circular);
      if (parts.length !== slides.length || parts.length < 3 || !parts.every(circular)) return false;
      const boxes = parts.map(c => c.absoluteBoundingBox);
      return boxes.every(b => b && b.width <= 48 && Math.abs(b.width-b.height) < 2) && boxes.every(b => Math.abs(b.y+b.height/2-boxes[0].y-boxes[0].height/2)<2);
    }
    function removeDots(node) {
      node.children = (node.children || []).filter(c => {
        const source = nodes.get(c.figmaNodeId || c.asset?.nodeId);
        if (dotStrip(source)) { dotSources.push(source); return false; }
        removeDots(c); return true;
      });
    }
    slides.forEach(removeDots);
    const source = nodes.get(n.figmaNodeId), box = source?.absoluteBoundingBox;
    let perPage = options.slidesPerView;
    if (!perPage && box) { const widths = slides.map(c => nodes.get(c.figmaNodeId)?.absoluteBoundingBox?.width || (typeof c.size?.width === "number" ? c.size.width : 0)).filter(w => w > 0); if (widths.length === slides.length && Math.max(...widths) - Math.min(...widths) < Math.max(...widths) * 0.05) perPage = Math.max(1, Math.min(slides.length, Math.floor((box.width + (n.layout?.gap || 0)) / (widths[0] + (n.layout?.gap || 0))))); }
    perPage ||= 1;
    const settings = { perPage: bare(perPage), type: options.loop ? "loop" : "slide", gap: bare(options.gap ?? n.layout?.gap ?? source?.itemSpacing), arrows: options.arrows ?? controls.some(c => /arrow|next|previous/i.test(sourceName(c, nodes))), pagination: dotSources.length > 0 || (options.pagination ?? controls.some(c => /pagination|dots/i.test(sourceName(c, nodes)))) };
    if (dotSources.length) report.push(`${n.id}: replaced ${dotSources.length} measured dot strips inside slides with native pagination.`);
    if (dotSources.length) {
      let strip = dotSources[0]; while (strip.children?.length === 1) strip = strip.children[0];
      const dots = strip.children, normal = dots.find(c => c.type === 'ELLIPSE'), active = dots.find(c => c.type !== 'ELLIPSE');
      if (normal) {
        settings.paginationWidth = bare(normal.absoluteBoundingBox.width); settings.paginationHeight = bare(normal.absoluteBoundingBox.height);
        const fill = normal.fills?.find(f => f.visible !== false && f.type === 'SOLID');
        if (fill) settings.paginationColor = { raw: figmaColor(fill.color, fill.opacity ?? 1) };
        const gap = dots.length > 2 ? dots[2].absoluteBoundingBox.x - dots[1].absoluteBoundingBox.x - dots[1].absoluteBoundingBox.width : 0;
        settings.paginationSpacing = { left: `${gap/2}px`, right: `${gap/2}px`, top: '0', bottom: '0' };
      }
      if (active) { settings.paginationWidthActive = bare(active.absoluteBoundingBox.width); settings.paginationHeightActive = bare(active.absoluteBoundingBox.height); }
      if (active) {
        const painted = descendants(active).find(c => c.fills?.some(f => f.visible !== false && f.type === 'GRADIENT_LINEAR'));
        const gradient = painted && resolveLinearGradient(painted.fills.find(f=>f.visible !== false && f.type === 'GRADIENT_LINEAR'), painted.absoluteBoundingBox);
        if (gradient) {
          const cssGradient = `linear-gradient(${gradient.angle}deg, ${gradient.stops.map(s=>`${s.color} ${s.position}%`).join(', ')})`;
          const inset = (active.absoluteBoundingBox.width-painted.absoluteBoundingBox.width)/2;
          const ring = descendants(active).find(c=>c.strokes?.some(p=>p.visible!==false));
          const selector = '#brxe-__ID__ > .splide__pagination .splide__pagination__page';
          settings._cssCustom = `${selector} { opacity: 1; transform: none; } ${selector}.is-active { background: transparent; position: relative; } ${selector}.is-active::before { content: ''; position: absolute; inset: ${inset}px; border-radius: 50%; background: ${cssGradient}; }`;
          if (ring?.strokeWeight) settings._cssCustom += ` ${selector}.is-active::after { content: ''; position: absolute; inset: 0; border: ${ring.strokeWeight}px solid transparent; border-radius: 50%; background: ${cssGradient} border-box; mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0); mask-composite: exclude; }`;
        }
      }
      const firstSlide = nodes.get(slides[0].figmaNodeId)?.absoluteBoundingBox, dotBox = dotSources[0].absoluteBoundingBox;
      if (firstSlide && dotBox) settings.paginationBottom = `${Math.max(0, firstSlide.y+firstSlide.height-dotBox.y-dotBox.height)}px`;
    }
    for (const [sourceKey, setting] of Object.entries({ slidesPerMove: "perMove", speed: "speed", interval: "interval", autoplay: "autoplay" })) if (options[sourceKey] !== undefined) settings[setting] = typeof options[sourceKey] === "boolean" ? options[sourceKey] : bare(options[sourceKey]);
    // Bricks' MCP rejects per-breakpoint keys (perPage:tablet_portrait ...) because Splide options are not CSS settings.
    // Responsive counts go into Splide's own "breakpoints" through the slider's Custom options (JSON) instead.
    const responsive = options.responsive || {};
    const splideBreakpoints = {};
    for (const bpt of BRICKS_BREAKPOINTS.variants) {
      const value = responsive[bpt.key];
      const count = value?.slidesPerView ?? (bpt.key === BRICKS_BREAKPOINTS.tablet ? Math.min(2, perPage) : 1);
      const o = { perPage: Number(count) };
      if (value?.slidesPerMove !== undefined) o.perMove = Number(value.slidesPerMove);
      if (value?.gap !== undefined) o.gap = Number(value.gap);
      splideBreakpoints[bpt.width] = o;
    }
    // The installed Bricks renderer treats a present checkbox key as enabled,
    // even when its value is false. Explicit Splide JSON preserves false and
    // avoids its unrelated 50vh default height.
    {
      const custom = { type: settings.type, perPage: Number(perPage), gap: `${Number(settings.gap || 0)}px`, arrows: settings.arrows, pagination: settings.pagination, height: 'auto', autoHeight: true, breakpoints: splideBreakpoints };
      if (settings.perMove !== undefined) custom.perMove = Number(settings.perMove);
      if (settings.speed !== undefined) custom.speed = Number(settings.speed);
      for (const key of ['autoplay','interval']) if (settings[key] !== undefined) custom[key] = settings[key];
      settings.optionsType = "custom";
      settings.options = JSON.stringify(custom);
    }
    const nativeSlides = slides.map(slide => {
      // A slide wrapper must not replace an image/text's editable content.
      const output = WRAPPERS.has(slide.type) ? slide : wrapper(`${slide.id}-slide`, [slide]);
      const slideSource = nodes.get(slide.figmaNodeId), slideBox = slideSource?.absoluteBoundingBox;
      const panel = slideSource && findPanels(slideSource).find(p => slideBox && Math.abs(p.box.width-slideBox.width)<2 && Math.abs(p.box.height-slideBox.height)<2);
      if (panel) {
        output.background = { color: panel.bg.color };
        output._pseudo = panel.layers.map((layer, i) => ({ asset: { nodeId: layer.id }, placement: i === 0 ? 'before' : 'after', inset: true }));
      }
      if (slideBox) output.size = { ...(output.size || {}), minHeight: slideBox.height };
      native(output, "block", { ...(output._nativeSettings || {}) }); output.size = { ...(output.size || {}), width: "fill" }; delete output.size.maxWidth;
      return output;
    });
    if (host) { host.children = nativeSlides; native(host, "slider-nested", settings); n.children = childNodes.filter(c => !control(c)); }
    else { native(n, "slider-nested", settings); n.children = nativeSlides; }
    if (controls.length) report.push(`${n.id}: ${controls.length} arrow/pagination design controls replaced with native slider controls.`);
    return null;
  }

  function tabs(n, options) {
    const kids = n.children || [];
    const menu = kids.find(c => role(c, "tab-menu", nodes)), content = kids.find(c => role(c, "tab-content", nodes));
    if (!menu || !content || !menu.children?.length || menu.children.length !== content.children?.length || kids.length !== 2) return "tabs require a tab-menu and tab-content with equal nonzero title/panel counts";
    if (options.openIndex !== undefined && options.openIndex >= menu.children.length) return "open tab index is outside the supplied tab list";
    native(n, "tabs-nested", { ...(options.openIndex !== undefined ? { openTab: String(options.openIndex) } : {}) });
    native(menu, "block"); classes(menu, "tab-menu");
    native(content, "block"); classes(content, "tab-content");
    for (const title of menu.children) { classes(title, "tab-title"); title._nativeLayoutLock = true; }
    for (const panel of content.children) { native(panel, "block"); classes(panel, "tab-pane"); panel._nativeManagedDisplay = true; }
    return null;
  }

  function accordion(n, options) {
    const items = n.children || [];
    if (!items.length) return "accordion has no items";
    if (options.openIndex !== undefined && options.openIndex >= items.length) return "open accordion index is outside the supplied item list";
    const pairs = items.map(item => { const children = item.children || []; return { item, title: children.find(c => role(c, "accordion-title", nodes) || /title|question/i.test(sourceName(c, nodes))), content: children.find(c => role(c, "accordion-content", nodes) || /content|answer/i.test(sourceName(c, nodes))) }; });
    if (pairs.some(({ item, title, content }) => !title || !content || item.children.length !== 2)) return "each accordion item requires title and content wrappers";
    native(n, "accordion-nested", { ...(options.openIndex !== undefined ? { expandItem: String(options.openIndex) } : {}), ...(options.independentToggle !== undefined ? { independentToggle: options.independentToggle } : {}), ...(options.transition !== undefined ? { transition: bare(options.transition) } : {}) });
    for (const [itemIndex, { item, title, content }] of pairs.entries()) {
      native(item, "block"); classes(item, "accordion-item");
      native(title, "block", { _attributes: [{name:'role',value:'button'},{name:'tabindex',value:'0'},{name:'aria-expanded',value:'false'}] }); classes(title, "accordion-title-wrapper");
      native(content, "block"); classes(content, "accordion-content-wrapper"); content._nativeManagedDisplay = true;
      for (const label of descendants(title).filter(c=>TEXT.has(c.type))) {
        if (nodes.get(label.figmaNodeId)?.lineTypes?.includes('ORDERED')) label.text = `${itemIndex+1}. ${label.text}`;
        label.typography = { ...(label.typography || {}), align: 'left' };
      }
    }
    return null;
  }

  function form(n, options) {
    if (!options.fields?.length) return "form field types/labels must be supplied explicitly in component.options.fields";
    const fieldsControl = schema("form").controls.fields;
    const fieldKeys = new Set(Object.keys(fieldsControl?.fields || {}));
    const fields = options.fields.map((field, index) => ({ id: field.id || fresh(`${n.id}-field-${index + 1}`), ...field }));
    if (new Set(fields.map(field => field.id)).size !== fields.length) return "form field IDs must be unique";
    for (const field of fields) {
      if (Object.keys(field).some(key => !fieldKeys.has(key) && key !== "id")) return "form field property is absent from the saved fields repeater schema";
      if (!(field.type in (fieldsControl?.fields?.type?.options || {}))) return `form field type ${field.type} is unsupported`;
    }
    const settings = { fields, ...(options.submitText ? { submitButtonText: options.submitText } : {}) };
    if (options.formName) report.push(`${n.id}: formName is retained as semantic metadata; no formName control exists in the saved runtime.`);
    if (options.actions?.length) {
      const allowed = schema("form").controls.actions?.options || {};
      if (options.actions.some(action => !(action in allowed))) return "a form action is unsupported by the saved runtime schema";
      settings.actions = options.actions;
    } else { settings.actions = []; report.push(`${n.id}: form submission actions are not specified; configure actions/recipients in Bricks before publishing.`); }
    if ((n.children || []).length) return "explicit native form requires fields in options and no additional child nodes (form is not nestable)";
    native(n, "form", settings);
    return null;
  }

  function visit(n, ancestors) {
    if (!WRAPPERS.has(n.type)) { for (const c of n.children || []) visit(c, [...ancestors, n]); return; }
    const label = sourceName(n, nodes), source = nodes.get(n.figmaNodeId), allLabels = descendants(n).map(c => sourceName(c, nodes)).join(" ");
    const kids = n.children || [];
    const row = n.type === "row" || n.layout?.direction === "row" || source?.layoutMode === "HORIZONTAL";
    let kind = n.component?.role ? null : n.component?.kind;
    if (!kind && /(^|[\s_-])(carousel|slider)([\s_-]|$)/i.test(label) && kids.length >= 2 && (/arrow|pagination|dots|next|previous/i.test(allLabels) || source?.clipsContent || ["INSTANCE", "COMPONENT"].includes(source?.type))) kind = "slider";
    // Carousel by geometry: three or more equal slides side by side that run well past the page width (a Figma slider lays its slides out in a row).
    if (!kind && !n.component && kids.length >= 3 && n.type !== "section") {
      const frameW = (figmaRoot?.document || figmaRoot)?.absoluteBoundingBox?.width || 0;
      const boxes = kids.map(c => nodes.get(c.figmaNodeId)?.absoluteBoundingBox);
      if (frameW && boxes.every(Boolean)) {
        const ws = boxes.map(b => b.width), hs = boxes.map(b => b.height), sorted = [...boxes].sort((a, b) => a.x - b.x);
        const span = sorted.at(-1).x + sorted.at(-1).width - sorted[0].x;
        const sideBySide = sorted.every((b, i) => !i || b.x >= sorted[i - 1].x + sorted[i - 1].width - 1);
        if (sideBySide && span > frameW * 1.3 && Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...hs) - Math.min(...hs) <= 2) {
          kind = "slider";
          n.component = { kind: "slider", options: { slidesPerView: 1, gap: Math.max(0, Math.round(sorted[1].x - sorted[0].x - sorted[0].width)) } };
          n.children = kids.slice().sort((a, b) => nodes.get(a.figmaNodeId).absoluteBoundingBox.x - nodes.get(b.figmaNodeId).absoluteBoundingBox.x);
          report.push(`${n.id}: ${kids.length} equal slides side by side past the page width -> native slider; controls require separate design evidence.`);
        }
      }
    }
    if (!kind && /(^|[\s_-])tabs([\s_-]|$)/i.test(label)) kind = "tabs";
    if (!kind && /(^|[\s_-])(accordion|faq)([\s_-]|$)/i.test(label)) kind = "accordion";
    if (!kind && row && kids.length >= 3 && kids.every(c => navigationLabel(c) && String(navigationLabel(c).text || "").length <= 48) && [label, ...ancestors.map(a => sourceName(a, nodes))].some(s => /(^|[\s_-])(nav|navigation|menu|header)([\s_-]|$)/i.test(s))) kind = "navigation";
    if (!kind && row) {
      const evidence = geometricNavigation(n, nodes, figmaRoot);
      if (evidence?.status === "native") { kind = "navigation"; report.push(`${n.id}: ${evidence.reason}.`); }
      else if (evidence) decision(n, "navigation", evidence.status, evidence.reason);
    }
    if (kind === "card") { n._componentKind = "card"; decision(n, kind, "recognized", "editable reusable layout; no global resource is created"); }
    else if (NATIVE_NAMES[kind]) {
      if (n.type === "section") {
        // Keep the full-width section band and move its interaction into an
        // editable child. A Nav must not replace the page's section semantics.
        const { padding, margin, ...layout } = n.layout || {};
        const inner = wrapper(`${n.id}-component`, n.children || []);
        inner.layout = layout; inner.component = n.component; inner.figmaNodeId = n.figmaNodeId; inner.figma = n.figma;
        n.children = [inner]; delete n.component;
        n.layout = { ...(padding ? { padding } : {}), ...(margin ? { margin } : {}) };
        visit(inner, [...ancestors, n]); return;
      }
      if (!schema(NATIVE_NAMES[kind])) decision(n, kind, "deferred", "runtime schema unavailable; original content retained");
      else {
        const baseline = clone(n), failure = ({ navigation, slider, tabs, accordion, form })[kind](n, n.component?.options || {}, ancestors);
        if (failure) { Object.keys(n).forEach(k => delete n[k]); Object.assign(n, baseline); decision(n, kind, "deferred", failure); }
        else { n._componentKind = kind; decision(n, kind, "native", "structure and controls verified against saved runtime schema"); return; }
      }
    }
    for (const c of n.children || []) visit(c, [...ancestors, n]);
  }
  visit(doc, []);
  return { doc, report, decisions };
}

/** Nonvisual invariant checks; does not claim JavaScript interaction was exercised. */
export function validateNativeComponents(tree) {
  const errors = [], warnings = [], byId = new Map((tree || []).map(el => [el.id, el]));
  const children = el => (el.children || []).map(id => byId.get(id)).filter(Boolean);
  const hasClass = (el, value) => `${el.settings?._cssClasses || ""} ${el.settings?._hidden?._cssClasses || ""}`.split(/\s+/).includes(value);
  const all = (el, seen = new Set()) => { if (seen.has(el.id)) return []; seen.add(el.id); return [el, ...children(el).flatMap(child => all(child, seen))]; };
  for (const el of tree || []) {
    if (el.name === "nav-nested") {
      const menu = children(el).find(c => hasClass(c, "brx-nav-nested-items"));
      if (!menu || menu.settings.tag !== "ul") errors.push(`${el.id}: native navigation requires its ul mobile/menu items wrapper.`);
      if (!children(el).some(c => c.name === "toggle") || !menu || !children(menu).some(c => c.name === "toggle")) errors.push(`${el.id}: native navigation requires open and close Toggle elements.`);
      for (const link of all(el).filter(c => c.name === "text-link")) if (!link.settings?.link) warnings.push(`${link.id}: navigation link destination is not configured.`);
    }
    if (el.name === "dropdown" && (children(el).length !== 1 || !hasClass(children(el)[0], "brx-dropdown-content"))) errors.push(`${el.id}: native dropdown requires one brx-dropdown-content wrapper.`);
    if (el.name === "slider-nested" && children(el).length < 2) errors.push(`${el.id}: recognized slider requires at least two slides.`);
    if (el.name === "tabs-nested") {
      const menu = children(el).find(c => hasClass(c, "tab-menu")), content = children(el).find(c => hasClass(c, "tab-content"));
      if (!menu || !content || !children(menu).length || children(menu).length !== children(content).length || children(menu).some(c => !hasClass(c, "tab-title")) || children(content).some(c => !hasClass(c, "tab-pane"))) errors.push(`${el.id}: native tabs require matching tab-title and tab-pane lists.`);
      if (el.settings?.openTab !== undefined && (!Number.isInteger(Number(el.settings.openTab)) || Number(el.settings.openTab) < 0 || Number(el.settings.openTab) >= children(menu || { children: [] }).length)) errors.push(`${el.id}: native open tab index is outside the supplied list.`);
    }
    if (el.name === "accordion-nested") for (const item of children(el)) if (!hasClass(item, "accordion-item") || !children(item).some(c => hasClass(c, "accordion-title-wrapper")) || !children(item).some(c => hasClass(c, "accordion-content-wrapper"))) errors.push(`${el.id}: invalid accordion item ${item.id}.`);
    if (el.name === "form") { if (!el.settings?.fields?.length) errors.push(`${el.id}: form has no native fields.`); if (el.settings?.fields && new Set(el.settings.fields.map(field => field.id)).size !== el.settings.fields.length) errors.push(`${el.id}: duplicate native form field IDs.`); if ((el.children || []).length) errors.push(`${el.id}: native Form is not nestable.`); if (!el.settings?.actions?.length) warnings.push(`${el.id}: form fields are editable; submission actions require configuration.`); }
  }
  return { errors, warnings };
}
