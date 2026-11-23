/**
 * Bricks element templates.
 *
 * Verified against a real export: homepage.json, 244 elements, analyzed via
 * scripts/bricks-analyzer.js (see schema/bricks-elements.json and
 * schema/bricks-settings.json for the full observed-keys data this was built
 * from). Confirmed real, not guessed:
 *
 *   - content IS a flat array. `id` is a 6-char lowercase alnum string
 *     (e.g. "ccitlw"). `parent` is either 0 (top-level) or another
 *     element's id string. `children` is an array of id STRINGS, not
 *     nested objects — resolve via a lookup map when you need child info.
 *   - _background color is { color: { raw: "#hex" } } — key is "raw", not "hex".
 *   - _typography.color is also { raw: "#hex" }, same shape.
 *   - link is { type: "external"|..., url: "...", postId: "..." } — not a bare string.
 *   - image/icon settings carry real WP attachment data: id, filename, size, full, url.
 *   - Responsive variants suffix the KEY: "_padding:tablet_portrait",
 *     "_padding:mobile_landscape", "_padding:mobile_portrait" (3 breakpoints
 *     observed, not the 5-6 some Bricks docs describe — confirm if you add more designs).
 *   - Pseudo-elements suffix the key: "_content::after", "_background::after", etc.
 *   - `themeStyles: []` appears on some elements (image/icon) — harmless to include as [].
 *
 * Still unverified / worth checking against a second real page before relying on it:
 *   - Whether these breakpoint names are fixed across your whole site or can vary by project.
 *   - Full _border and _boxShadow nested shapes beyond "radius"/"color"+"values" (only
 *     partially observed — see schema/bricks-settings.json, re-run analyzer on more pages).
 */

import { BRICKS_BREAKPOINTS } from "./breakpoints.js";

export function makeId() {
  // Confirmed shape from real data: 6 lowercase alphanumeric chars, e.g. "ccitlw".
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}


// ---------------------------------------------------------------------------
// normalized node  ->  Bricks element   (schema/normalized-schema.json is the input contract)
//
// Two layers:
//   * styleSettings(src)  maps the shared STYLE fields (layout, size,
//     background, border, boxShadow, typography) to Bricks setting keys.
//     Used for the base node AND for each responsive override, so a
//     breakpoint override is compiled by exactly the same code as desktop,
//     then every key gets the ":<breakpoint>" suffix.
//   * ELEMENT_TEMPLATES   add the element's name + content settings on top.
//
// Value formats follow what your real export uses (verified in homepage.json):
//   gaps / padding / margin / _width / _heightMin  -> bare number strings ("32")
//   _widthMax                                       -> with unit ("513px")
//   radius                                          -> with unit ("8px")
//   colors                                          -> { raw: "#hex" }
// ---------------------------------------------------------------------------

// Buttons hug their label: a fixed Figma width (padding included) makes Bricks wrap the text ("Learn / More").
// A button that fills its parent (a full-width "Play Now") keeps width 100%.
function hugButton(el, fill = false) {
  if (el?.settings) { if (!fill) delete el.settings._width; delete el.settings._widthMax; }
  return el;
}

export const BREAKPOINTS = BRICKS_BREAKPOINTS.keys;

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between" };

const isNum = (v) => typeof v === "number" && isFinite(v);
const bare = (n) => (n === undefined || n === null ? undefined : String(n));

function sidesToBricks(s) {
  if (!s) return undefined;
  const out = {};
  for (const k of ["top", "right", "bottom", "left"]) if (s[k] !== undefined) out[k] = bare(s[k]);
  return Object.keys(out).length ? out : undefined;
}

// size value -> Bricks string. `numberAs` decides how a plain px number is written.
function dimension(v, numberAs) {
  if (v === undefined || v === null || v === "hug") return undefined;
  if (v === "fill") return "100%";
  if (typeof v === "number") return numberAs === "px" ? `${v}px` : String(v);
  return v;
}

function layoutSettings(l = {}) {
  const grid = l.display === "grid";
  return {
    _display: l.display,
    _direction: grid ? undefined : l.direction,
    _rowGap: grid ? bare(l.gridRowGap) : bare(l.rowGap ?? l.gap), // grid: only set when its row gap differs from the column gap (_gridGap sets both)
    _columnGap: grid ? undefined : bare(l.columnGap ?? l.gap),
    // Grid (key names taken from a real Bricks 2.4.2 export): columns as a repeat() template, one gap value for both axes.
    _gridTemplateColumns: l.gridColumns ? (l.gridColumns === 1 ? "1fr" : `repeat(${l.gridColumns}, 1fr)`) : undefined,
    _gridGap: l.gridGap !== undefined ? bare(l.gridGap) : undefined,
    _alignItems: grid ? undefined : ALIGN[l.align],
    _alignItemsGrid: grid ? ALIGN[l.align] : undefined, // Bricks' own key for align-items on a grid (as in a real export)
    _justifyContent: JUSTIFY[l.justify],
    _flexWrap: l.wrap ? "wrap" : undefined,
    _padding: sidesToBricks(l.padding),
    _margin: sidesToBricks(l.margin),
  };
}

function sizeSettings(z = {}) {
  return {
    _width: dimension(z.width, "bare"),
    _widthMax: dimension(z.maxWidth, "px"),
    _height: dimension(z.height, "bare"),
    _heightMin: dimension(z.minHeight, "bare"),
    _heightMax: dimension(z.maxHeight, "bare"),
    _widthMin: z.minWidth === "fill" ? "100%" : dimension(z.minWidth, "bare"),
  };
}

function typographyFromNode(t) {
  if (!t) return undefined;
  // lineHeight / letterSpacing arrive with an explicit unit ("135%", "25.5px"); pass through untouched.
  // colorGradient is handled separately by the caller (it becomes a sibling _gradient setting,
  // not part of _typography) since that's the shape Bricks actually stores it in.
  return {
    "font-family": t.fontFamily,
    "font-size": t.fontSize !== undefined ? `${t.fontSize}px` : undefined,
    "font-weight": t.fontWeight !== undefined ? String(t.fontWeight) : undefined,
    "line-height": t.lineHeight,
    "letter-spacing": t.letterSpacing ?? "0%",
    color: t.color ? { raw: t.color } : undefined,
    "text-align": t.align,
    "text-transform": t.textTransform,
  };
}

// Normalized gradient -> Bricks' native _gradient shape (observed in homepage.json:
// { applyTo, gradientType: "linear", angle, colors: [{ id, color: { raw }, stop: "N%" }] }).
// `applyTo` is "text" or "background" depending on where the gradient was set.
function gradientSettings(g, applyTo) {
  if (!g) return undefined;
  return {
    applyTo,
    gradientType: "linear",
    angle: String(g.angle),
    colors: g.stops.map((s, i) => ({
      id: `g${i}`, // Bricks requires a stable per-stop id; any unique string works
      color: { raw: s.color },
      stop: `${s.position}%`,
    })),
  };
}

// Shared style mapping. `src` is a node or a responsive override.
function styleSettings(src) {
  const out = {
    ...layoutSettings(src.layout),
    ...sizeSettings(src.size),
    _typography: typographyFromNode(src.typography),
  };
  // 100% wide plus a side margin is wider than the parent: take the margin out of the width
  if (out._width === "100%" && out._widthMax === undefined) {
    const m = src.layout?.margin, side = (Number(m?.left) || 0) + (Number(m?.right) || 0);
    if (side > 0) out._width = `calc(100% - ${side}px)`;
  }
  // Background: solid color OR gradient, never both (schema enforces this on the normalized side).
  if (src.background?.gradient) {
    out._gradient = gradientSettings(src.background.gradient, "background");
  } else if (src.background?.color) {
    out._background = { color: { raw: src.background.color } };
  }
  // Gradient text fill is a sibling _gradient setting with applyTo:"text", not part of _typography.
  // Bricks has one _gradient slot per element, so a node can't have both a gradient background
  // AND gradient text at once - flag it loudly rather than silently dropping one.
  if (src.typography?.colorGradient) {
    if (out._gradient) {
      console.warn("Node has both background.gradient and typography.colorGradient - Bricks supports only one _gradient per element. Keeping text gradient, dropping background gradient.");
    }
    out._gradient = gradientSettings(src.typography.colorGradient, "text");
  }
  if (src.border?.radius !== undefined) {
    const r = `${src.border.radius}px`;
    out._border = { radius: { top: r, right: r, bottom: r, left: r } };
  }
  if (src.border?.color && src.border?.width > 0) {
    const w = String(src.border.width);
    // border.sides (a divider line on one edge of its parent, from structure-rules.js) limits the stroke to those sides
    const sides = Array.isArray(src.border.sides) && src.border.sides.length ? src.border.sides : ["top", "right", "bottom", "left"];
    out._border = { ...(out._border || {}), style: "solid", color: { raw: src.border.color }, width: Object.fromEntries(sides.map((sd) => [sd, w])) };
  }
  if (src.boxShadow) {
    const b = src.boxShadow;
    out._boxShadow = {
      color: { raw: b.color },
      values: { blur: bare(b.blur), offsetX: bare(b.offsetX), offsetY: bare(b.offsetY), spread: bare(b.spread) },
    };
  }
  return out;
}

function responsiveSettings(node) {
  const out = {};
  for (const bp of BREAKPOINTS) {
    const ov = node.responsive?.[bp];
    if (!ov) continue;
    for (const [k, v] of Object.entries(styleSettings(ov))) {
      if (v !== undefined) out[`${k}:${bp}`] = v;
    }
  }
  return out;
}

// Layout the element type implies on its own; explicit node.layout wins.
export function buildBricksElement(name, node, { content = {}, implied = {}, themeStyles } = {}) {
  const merged = { ...node, layout: { ...implied, ...(node.layout || {}) } };
  const el = {
    name,
    settings: { ...content, ...styleSettings(merged), ...responsiveSettings(node) },
  };
  applyLayers(node, el.settings);
  if (node.globalClasses?.length) el.settings._cssGlobalClasses = [...new Set(node.globalClasses)];
  if (node.cssClasses?.length) el.settings._cssClasses = [...new Set(node.cssClasses)].join(" ");
  // Leaf elements (text, heading, icon, image) are not flex containers: Bricks rejects _direction / _rowGap / _columnGap on them
  // ("Invalid value for settings._direction"). A model sometimes puts layout on a heading; drop those keys, also their breakpoint forms.
  if (LEAF_NAMES.has(name)) {
    for (const k of Object.keys(el.settings)) if (/^(_direction|_rowGap|_columnGap)(:|$)/.test(k)) delete el.settings[k];
  }
  if (name === "button") {
    for (const key of Object.keys(el.settings)) {
      const replacements = { _direction: "_flexDirection", _rowGap: "_gap", _columnGap: "iconGap" };
      const base = key.split(":")[0];
      if (!replacements[base]) continue;
      const target = replacements[base] + key.slice(base.length);
      if (el.settings[target] === undefined) el.settings[target] = el.settings[key];
      delete el.settings[key];
    }
  }
  if (themeStyles !== undefined) el.themeStyles = themeStyles;
  return el;
}
const build = buildBricksElement;
const LEAF_NAMES = new Set(["heading", "text", "text-basic", "icon", "image"]);

// Layer support (set by responsive-pass.js): section background image + gradient overlay, absolutely placed decoration.
// "__ID__" in _cssCustom is replaced with the real Bricks element id by the compiler once it is known.
function gradientCss(g) {
  return `linear-gradient(${g.angle}deg, ${g.stops.map((x) => `${x.color} ${x.position}%`).join(", ")})`;
}
function applyLayers(node, settings) {
  const css = [];
  if (node._bgImage) {
    settings._background = {
      ...(settings._background || {}),
      image: assetRef(node._bgImage),
      size: node._bgSize || "cover", // a raster photo covers its box; a vector backdrop (a curve line) is shown whole
      position: "center center",
      repeat: "no-repeat",
      attachment: "scroll",
    };
  }
  if (node._overlay) {
    css.push(`#brxe-__ID__::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background: ${gradientCss(node._overlay)};\n  pointer-events: none;\n  z-index: 0;\n}`);
    for (const child of node.children || []) if (!child.abs && child.figma?.position?.mode !== 'absolute') child._raise = true;
  }
  if (node._pseudo?.length) {
    // Decoration layers as pseudo-element background images (Bricks stores them as "_key::before" / "_key::after").
    // The pseudo-element is absolutely placed, drawn under the content, and never takes clicks.
    settings._position = "relative"; settings._overflow = "hidden";
    for (const l of node._pseudo) {
      const P = `::${l.placement}`;
      settings[`_content${P}`] = " ";
      settings[`_position${P}`] = "absolute";
      // Bricks does not carry a pseudo-element's position down to the smaller breakpoints by itself: without these the layer falls back
      // into the flow on tablet / phone (the hand-made file has to set `_position:tablet_portrait::after` for the same reason)
      for (const bp of BREAKPOINTS) settings[`_position:${bp}${P}`] = "absolute";
      settings[`_background${P}`] = { image: assetRef(l), size: l.inset ? "cover" : "contain", position: "center center", repeat: "no-repeat", attachment: "scroll", blendMode: "normal" };
      if (l.inset) for (const side of ["top", "right", "bottom", "left"]) settings[`_${side}${P}`] = "0";
      else {
        settings[`_left${P}`] = `${l.box.left}%`; settings[`_top${P}`] = `${l.box.top}px`;
        settings[`_width${P}`] = `${l.box.width}px`; settings[`_height${P}`] = `${l.box.height}px`;
      }
    }
    css.push(`#brxe-__ID__::before, #brxe-__ID__::after {\n  pointer-events: none;\n  z-index: 0;\n}\n#brxe-__ID__ > * {\n  position: relative;\n  z-index: 1;\n}`);
  }
  if (node._spanCss) css.push(node._spanCss); // a second text style inside the element: #brxe-__ID__ span { ... }
  if (node._relative) settings._position = "relative"; // positioning context for absolutely placed layers
  if (node._layered) { settings._position = "relative"; settings._overflow = "hidden"; }
  if (node._raise) { settings._position = "relative"; settings._zIndex = "1"; }
  if (node.abs) {
    settings._position = "absolute";
    settings._left = node.abs.left;
    settings._top = node.abs.top;
    if (node.abs.width !== undefined) settings._width = `${node.abs.width}px`;
    settings._zIndex = node.abs.z ?? "0"; // decoration sits behind the content (0); a layer on a picture (badge, label) above it (1)
    delete settings._widthMax;
    delete settings._height; // aspect ratio comes from the asset
    if(node._fullOverlay){settings._width='100%';settings._height='100%';}
    delete settings._margin;
    if (node.abs.opacity !== undefined && node.abs.opacity < 1) css.push(`#brxe-__ID__ {\n  opacity: ${node.abs.opacity};\n}`);
  }
  if (css.length) settings._cssCustom = css.join("\n");
}

// Bricks heading/text/button content is HTML. Plain copy from Figma ("Theme & Graphics", "RTP < 90%") must be escaped or the browser reads the
// & / < as markup. Text that already holds a tag or a finished entity (&amp;) is left exactly as it is.
export function escapeText(text) {
  if (typeof text !== "string" || !text) return text;
  if (/<\/?[a-z!][^>]*>/i.test(text)) return text;
  return text.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, '<br>');
}

function wrapAsParagraphIfNeeded(text) {
  if (!text) return text;
  return /^\s*<[a-z][\s\S]*>/i.test(text.trim()) ? text : `<p>${escapeText(text)}</p>`;
}

function assetRef(node) {
  // Filled with local paths by stage 3, swapped for real WP attachments by stage 4.
  return {
    id: node._resolvedAttachmentId || null,
    filename: node._resolvedFilename || null,
    size: "full",
    full: node._resolvedAssetUrl || null,
    url: node._resolvedAssetUrl || null,
  };
}

export const ELEMENT_TEMPLATES = {
  section: (n) => build("section", n),
  container: (n) => build("container", n),
  row: (n) => build("div", n, { implied: { display: "flex", direction: "row" } }),
  column: (n) => build("div", n, { implied: { display: "flex", direction: "column" } }),
  block: (n) => build("div", n, { implied: { display: "block" } }),
  spacer: (n) => build("div", n),

  heading: (n) => build("heading", n, { content: { text: escapeText(n.text), tag: `h${n.level || 2}` } }),

  // "text" = rich paragraph (HTML-wrapped), "text-basic" = plain label. Distinct in your real data.
  text: (n) => build("text", n, { content: { text: wrapAsParagraphIfNeeded(n.text) } }),
  "text-basic": (n) => build("text-basic", n, { content: { text: escapeText(n.text) } }),

  button: (n) => hugButton(
    build("button", n, {
      content: {
        text: escapeText(n.text),
        // Observed shape: {type, url, postId}. postId is present even on external links.
        link: n.href ? { type: "external", url: n.href, postId: "" } : undefined,
        // Pre-exported icon (found by the responsive pass from the node's notes) becomes a real Bricks button icon.
        ...(n._buttonIconUrl
          ? { icon: { library: "svg", svg: { id: null, filename: null, size: "full", full: n._buttonIconUrl, url: n._buttonIconUrl }, height: "24", width: "24" }, iconPosition: "left", iconGap: bare(n.layout?.gap ?? 10) + "px" }
          : {}),
      },
    }), n.size?.width === "fill" && n.size?.maxWidth === undefined),

  image: (n) => build("image", n, { content: { image: assetRef(n) }, themeStyles: [] }),

  icon: (n) => {
    const el = build("icon", n, {
      content: {
        icon: {
          library: "svg",
          svg: assetRef(n),
          height: bare(n.size?.height),
          width: isNum(n.size?.width) ? bare(n.size.width) : undefined, // "fill" is not a valid icon width
        },
      },
      themeStyles: [],
    });
    // Icon size lives inside icon{}, not as _width/_height on the element.
    delete el.settings._width;
    delete el.settings._height;
    return el;
  },
};
