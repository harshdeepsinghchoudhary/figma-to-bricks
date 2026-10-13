/**
 * Stage 2: LLM normalization
 *
 * Usage:
 *   node scripts/2_normalize.js output/<frame-name>
 *
 * Reads figma-node.json + screenshot.png from that dir, plus every pair in
 * examples/, and asks the model to produce normalized.json — a
 * builder-agnostic description of the section (NOT Bricks syntax).
 *
 * The model never emits Bricks JSON. That's stage 3's job, deterministically.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import fetch from "node-fetch";
import { validateNormalized } from "./normalized-validator.js";
import { collectGradients } from "./gradient-utils.js";
import { sanitize, finalize, rebuildFromGeometry } from "./normalize-postprocess.js";
import { isGraphicNode, hasImageFill } from "./graphic-detect.js";

// Provider is chosen explicitly via AI_PROVIDER=groq|anthropic in .env, or auto-detected
// from whichever API key is present (GROQ_API_KEY -> groq, else ANTHROPIC_API_KEY ->
// anthropic) so switching later is just swapping which key is set, nothing in code.
// The Anthropic SDK is imported lazily below (only when actually used) so this script
// doesn't require it to be installed/configured when running Groq-only.
const PROVIDER = (process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : "anthropic")).toLowerCase();
// Also supported: AI_PROVIDER=gemini (free tier, big context, needs GEMINI_API_KEY) and
// AI_PROVIDER=ollama (fully local, no key, no limits).
if (!["groq", "anthropic", "gemini", "ollama", "nvidia", "auto"].includes(PROVIDER)) {
  console.error(`Unknown AI_PROVIDER "${PROVIDER}" - expected "groq", "anthropic", "gemini", "ollama", "nvidia" or "auto".`);
  process.exit(1);
}

// AI_PROVIDER=auto: try providers in order and move to the next one whenever a call fails (busy, rate limit, bad model id...).
// Default order nvidia -> groq (Gemini is left out; add it back with AI_PROVIDER_CHAIN=gemini,nvidia,groq); override with AI_PROVIDER_CHAIN=gemini,nvidia,groq. Providers without a key are skipped.
const HAS_KEY = { gemini: !!process.env.GEMINI_API_KEY, nvidia: !!process.env.NVIDIA_API_KEY, groq: !!process.env.GROQ_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, ollama: true };
let CHAIN = PROVIDER === "auto"
  ? (process.env.AI_PROVIDER_CHAIN || "nvidia,groq").split(",").map((p) => p.trim().toLowerCase()).filter((p) => HAS_KEY[p])
  : [PROVIDER];
if (!CHAIN.length) {
  console.error("AI_PROVIDER=auto but none of the providers in the chain has an API key in .env (NVIDIA_API_KEY, GROQ_API_KEY).");
  process.exit(1);
}
let activeProvider = CHAIN[0]; // the provider that answered last (the repair-retry style depends on it)
const modelFor = (p) =>
  p === "groq" ? process.env.GROQ_MODEL || null
  : p === "gemini" ? process.env.GEMINI_MODEL || "gemini-3.8-flash"
  : p === "ollama" ? process.env.OLLAMA_MODEL || "qwen2.5:14b"
  : p === "nvidia" ? process.env.NVIDIA_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct"
  : process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const maxTokensFor = (p) => {
  const n = Number(process.env.AI_MAX_TOKENS);
  if (p === "groq") return Math.min(n || 8000, 8000); // Groq free-tier models reject larger outputs
  if (p === "nvidia") return n || 8000;
  return n || 16000;
};

// --split[=5500]  send a section that is too big for one request in several parts (each part under the token budget),
//                 then stitch the answers back together from the Figma geometry. Happens automatically when Groq is the only way out.
// --resume        with --split: reuse parts already saved in <section>/parts/ instead of asking the model again.
const splitArg = process.argv.find((a) => a === "--split" || a.startsWith("--split="));
const SPLIT = !!splitArg;
const splitBudgetArg = splitArg && splitArg.includes("=") ? Number(splitArg.split("=")[1]) : null;
const RESUME = process.argv.includes("--resume");
// --estimate     build exactly the prompts this run would send, print the token count and cost range, and stop. Nothing is sent to any model.
const ESTIMATE = process.argv.includes("--estimate");
const frameDir = process.argv[2];
// --nodes=id1,id2,... scopes the run to just those top-level children of the cached
// figma-node.json (e.g. testing "just the hero" before spending a real call on the
// whole 16000px page). IDs are matched against the frame's DIRECT children only -
// this file's real pages are a flat canvas of loose top-level siblings grouped purely
// by y-position, not nested section frames, so that's the level scoping needs to work at.
const nodesArg = process.argv.find((a) => a.startsWith("--nodes="));
const scopeIds = nodesArg ? nodesArg.slice("--nodes=".length).split(",").map((s) => s.trim()).filter(Boolean) : null;
// Optional human-readable name for the scoped output folder, e.g. --name=hero
// (otherwise one is derived from the scoped nodes' names, which can look messy).
const nameArg = process.argv.find((a) => a.startsWith("--name="));
const scopeName = nameArg ? nameArg.slice("--name=".length).trim() : null;
if (!frameDir) {
  console.error("Usage: node scripts/2_normalize.js output/<frame-name> [--nodes=id1,id2,...]");
  process.exit(1);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40).replace(/-+$/, "") || "scope"; // trim again after slicing: "...and-" + "-5" made an invalid "--5" id
}

// Builds a synthetic wrapper frame containing only the requested direct children, in the
// order given, so every downstream consumer (gradient collection, the model prompt) sees
// an ordinary-looking root node and nothing needs to know scoping happened.
function buildScopedRoot(fullRoot, ids) {
  const byId = new Map((fullRoot.children || []).map((c) => [c.id, c]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(
      `--nodes: these ids are not DIRECT children of the root frame (scoping only matches top-level siblings): ${missing.join(", ")}`
    );
  }
  // Hidden layers (visible:false) aren't part of the design and stage 1 never exports them.
  // They can also sit far off-canvas, which would blow up the wrapper box and screenshot crop.
  const hidden = ids.filter((id) => byId.get(id).visible === false);
  if (hidden.length) console.warn(`Skipping hidden layer(s) in --nodes: ${hidden.map((id) => `${id} (${byId.get(id).name})`).join(", ")}`);
  const children = ids.filter((id) => !hidden.includes(id)).map((id) => byId.get(id));
  const boxes = children.map((c) => c.absoluteBoundingBox).filter(Boolean);
  const absoluteBoundingBox = boxes.length
    ? {
        x: Math.min(...boxes.map((b) => b.x)),
        y: Math.min(...boxes.map((b) => b.y)),
        width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
        height: Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
      }
    : undefined;
  return { id: "scope", name: `${fullRoot.name} (scoped)`, type: "FRAME", absoluteBoundingBox, children };
}

// Every node id anywhere under `root` (including root itself) - used to trim the asset
// manifest down to only assets actually reachable from a scoped subtree.
function collectIds(root, acc = new Set()) {
  acc.add(root.id);
  for (const c of root.children || []) collectIds(c, acc);
  return acc;
}

// Replaces every node stage 1 would export as a single flat SVG/PNG asset (icons, logos,
// illustrations) with a tiny stub: just enough (id, name, type, bounding box) for the model
// to place an image/icon element there using the asset manifest - not its raw vector path
// data, which the model never needs and which can be 100x+ larger than everything else in
// the node combined (a 200-path illustration's Figma JSON is mostly bezier point arrays).
// Must run AFTER collectGradients() on the same tree, since a gradient fill is captured by
// nodeId/color/angle at that point and doesn't need the node to still be intact afterward.
// Returns { tree, count, charsSaved } rather than using module-level counters, so this
// stays safe to call more than once per process (e.g. a future batch mode over sections).
function pruneGraphics(node, stats = { count: 0, charsSaved: 0 }) {
  if (!hasImageFill(node) && node.type !== "TEXT" && node.absoluteBoundingBox) {
    const { isGraphic, vectors } = isGraphicNode(node);
    if (isGraphic) {
      stats.count++;
      (stats.prunedIds = stats.prunedIds || new Set());
      for (const id of collectIds(node)) stats.prunedIds.add(id); // the node and everything under it
      stats.charsSaved += JSON.stringify(node).length;
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        ...(node.visible === false ? { visible: false } : {}),
        absoluteBoundingBox: node.absoluteBoundingBox,
        _note: `pruned from prompt: this is a single exportable graphic asset (${vectors} vector shape(s)) already in the asset manifest by this nodeId - place it as an image/icon element, do not expect child elements here`,
      };
    }
  }
  const out = { ...node };
  if (node.children) out.children = node.children.map((c) => pruneGraphics(c, stats));
  return out;
}

// ids of pruned-graphic stubs (nodes carrying the "pruned from prompt" note) - these keep their manifest entry
function prunedStubIds(root, acc = new Set()) {
  if (root._note && /pruned from prompt/.test(root._note)) acc.add(root.id);
  for (const c of root.children || []) prunedStubIds(c, acc);
  return acc;
}

// ---- Compact mode (Groq free tier: ~7-8k tokens per request) -------------------------
// Whitelist of keys that actually affect layout/styling, colors as hex, box as
// [x,y,w,h], stub nodes reduced to {asset:true}. Gradient math is precomputed elsewhere.
const r2 = (n) => Math.round(n * 100) / 100;
const toHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
function compactPaint(p) {
  if (!p || p.visible === false) return null;
  const a = r2((p.opacity ?? 1) * (p.color?.a ?? 1));
  if (p.type === "SOLID") {
    // Alpha is baked into the hex (#RRGGBBAA, which the schema allows) so the model can't drop it into notes.
    const ah = a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase() : "";
    return { t: "SOLID", c: toHex(p.color).toUpperCase() + ah };
  }
  if (p.type === "GRADIENT_LINEAR") return { t: "GRADIENT_LINEAR", note: "see PRECOMPUTED GRADIENTS by nodeId" };
  if (p.type === "IMAGE") return { t: "IMAGE", scale: p.scaleMode };
  return { t: p.type, note: "unsupported" };
}
const KEEP_NODE = ["id", "name", "type", "characters", "layoutMode", "itemSpacing", "counterAxisSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "primaryAxisAlignItems", "counterAxisAlignItems", "layoutWrap", "layoutSizingHorizontal", "layoutSizingVertical", "layoutGrow", "layoutAlign", "clipsContent", "cornerRadius", "rectangleCornerRadii", "strokeWeight"];
const KEEP_STYLE = ["fontFamily", "fontSize", "fontWeight", "textAlignHorizontal", "textCase", "textDecoration"];
// Units are resolved here, never left to the model (it copied 135% as "135px" before).
function compactTextStyle(style) {
  const st = {};
  for (const k of KEEP_STYLE) if (style[k] !== undefined) st[k] = typeof style[k] === "number" ? r2(style[k]) : style[k];
  const unit = style.lineHeightUnit;
  if (unit === "PIXELS" && style.lineHeightPx) st.lineHeight = `${r2(style.lineHeightPx)}px`;
  else if (unit === "FONT_SIZE_%" && style.lineHeightPercentFontSize) st.lineHeight = `${r2(style.lineHeightPercentFontSize)}%`;
  else if (style.lineHeightPx && style.fontSize) st.lineHeight = `${r2(style.lineHeightPx)}px`;
  if (style.letterSpacing) st.letterSpacing = `${r2(style.letterSpacing)}px`;
  return st;
}
// Recursive XY-cut over loose layers. Returns an array of nodes/groups.
function xyCut(items) {
  if (items.length <= 1) return items.map((i) => i.o);
  const bands = (axis) => {
    const [pos, len] = axis === "y" ? ["y", "height"] : ["x", "width"];
    const sorted = [...items].sort((a, b) => a.b[pos] - b.b[pos]);
    const out = [];
    const gaps = [];
    let cur = [sorted[0]];
    let end = sorted[0].b[pos] + sorted[0].b[len];
    for (const it of sorted.slice(1)) {
      if (it.b[pos] >= end - 0.5) {
        out.push(cur);
        gaps.push(it.b[pos] - end);
        cur = [it];
        end = it.b[pos] + it.b[len];
      } else {
        cur.push(it);
        end = Math.max(end, it.b[pos] + it.b[len]);
      }
    }
    out.push(cur);
    return { bands: out, gaps };
  };
  const v = bands("y");
  const h = bands("x");
  const score = (r) => (r.bands.length > 1 ? Math.max(...r.gaps) : -1);
  if (score(v) < 0 && score(h) < 0) return items.map((i) => i.o); // overlapping layers: leave flat
  const pick = score(v) >= score(h) ? { r: v, g: "column" } : { r: h, g: "row" };
  // Cross-axis offset: how far each child starts from the group's start edge on the other axis
  // (row: from the top, column: from the left), so alignment/margins never need estimating.
  const cross = pick.g === "row" ? "y" : "x";
  const groupStart = Math.min(...items.map((i) => i.b[cross]));
  const children = pick.r.bands.map((band) => {
    const res = xyCut(band);
    const node = res.length === 1 ? res[0] : { g: "overlapping", note: "layers overlap; no auto-layout possible", children: res };
    const off = Math.min(...band.map((i) => i.b[cross])) - groupStart;
    if (off > 0.5) node.offCross = r2(off);
    return node;
  });
  return [{ g: pick.g, gaps: pick.r.gaps.map(r2), children }];
}

let manifestIds = new Set();
// relaxBg: also treat a full-size background rectangle as the parent's background when the group has only TWO children (rectangle + one
// inner group - the usual card). It is off while building prompts, so the way a section is cut into parts (and therefore every saved
// part in parts/ that --resume reuses) does not change; it is on for the measured tree used to stitch and post-process.
let relaxBg = false;
const compactMeasured = (node) => { relaxBg = true; try { return compactFigma(node); } finally { relaxBg = false; } };
function compactFigma(node) {
  if (node.visible === false) return null; // hidden layers: stage 1 skips them too, so they're never exported
  if (node._note && String(node._note).startsWith("pruned")) {
    const b = node.absoluteBoundingBox;
    return { id: node.id, name: node.name, type: node.type, asset: true, ...(b ? { box: [b.x, b.y, b.width, b.height].map(r2) } : {}) };
  }
  const out = {};
  for (const k of KEEP_NODE) if (node[k] !== undefined && node[k] !== null && node[k] !== "") out[k] = typeof node[k] === "number" ? r2(node[k]) : node[k];
  if (typeof out.characters === "string") out.characters = out.characters.replace(/\u2028/g, "\n"); // Figma soft line breaks: make them real \n so the model copies them exactly
  const b = node.absoluteBoundingBox;
  if (b) out.box = [b.x, b.y, b.width, b.height].map(r2);
  if (node.opacity !== undefined && node.opacity !== 1) out.opacity = r2(node.opacity);
  if (hasImageFill(node)) out.imageExported = manifestIds.has(node.id);
  const fills = (node.fills || []).map(compactPaint).filter(Boolean);
  if (fills.length) out.fills = fills;
  const strokes = (node.strokes || []).map(compactPaint).filter(Boolean);
  if (strokes.length) out.strokes = strokes;
  if (node.effects?.some((e) => e.visible !== false)) out.effects = node.effects.filter((e) => e.visible !== false).map((e) => e.type);
  if (node.style) out.style = compactTextStyle(node.style);
  if (node.children?.length) {
    const kids = node.children.filter((c) => c.visible !== false);
    out.children = kids.map(compactFigma).filter(Boolean);
    // Loose siblings (no auto-layout) carry no grouping or gap data in Figma. Recover it
    // geometrically with a recursive XY-cut: split on the widest empty horizontal/vertical
    // band, wrap each side as {g:"column"|"row", gaps:[measured px], children}, and recurse.
    if (!node.layoutMode || node.layoutMode === "NONE") {
      const items = kids.map((c, i) => ({ o: out.children[i], b: c.absoluteBoundingBox, c })).filter((it) => it.o);
      // A full-bleed background rectangle overlaps every sibling and defeats the XY-cut (it came back flat,
      // with no row/column/gap hints). Pull it out, mark it as the parent's background, cut the rest.
      // A card is often just [background rectangle, one inner group] (2 children), so 2 siblings are enough - unless the only other
      // sibling is a TEXT, which is a button/label (its rectangle is the button's own fill, handled on the button itself).
      const enoughSiblings = items.length > 2 || (relaxBg && items.length === 2 && items.some((x) => x.c.type !== "RECTANGLE" && x.c.type !== "TEXT"));
      const isBg = (it) => b && it.b && it.c.type === "RECTANGLE" && !it.c.children?.length && !hasImageFill(it.c)
        && it.b.width >= b.width * 0.98 && it.b.height >= b.height * 0.98 && enoughSiblings;
      // collapseArtGroups: a card drawn as a GROUP of shapes (rectangle + mask + decorative vector) is not a bare RECTANGLE, so it was never
      // recognised as the background and the text on top of it landed in a separate div. In the measured tree only (prompts are untouched, so
      // saved --resume parts stay valid) a shapes-only group that covers the parent is replaced by its full-size rectangle, which the code below
      // flags as the parent's background. Decorative shapes (masked vectors) stay out of the layout flow.
      if (relaxBg && b && items.length >= 2) {
        const hasText = (x) => x.type === "TEXT" || (x.children || []).some(hasText);
        const hasImg = (x) => hasImageFill(x) || (x.children || []).some(hasImg);
        const covers = (bx) => bx && bx.width >= b.width * 0.98 && bx.height >= b.height * 0.98;
        const bgRectIn = (x) => {
          if (x.visible === false) return null;
          if (x.type === "RECTANGLE" && !x.children?.length && covers(x.absoluteBoundingBox) && (x.fills || []).some((f) => f.visible !== false && (f.type === "SOLID" || String(f.type).startsWith("GRADIENT")))) return x;
          for (const ch of x.children || []) { const r = bgRectIn(ch); if (r) return r; }
          return null;
        };
        for (const it of items) {
          if (it.c.type !== "GROUP" || (it.c.layoutMode && it.c.layoutMode !== "NONE") || !covers(it.b) || !it.c.children?.length || hasText(it.c) || hasImg(it.c)) continue;
          const rect = bgRectIn(it.c);
          const at = rect ? out.children.indexOf(it.o) : -1;
          if (at < 0) continue;
          console.log("  card background: group \"" + it.c.name + "\" collapsed to its rectangle (decorative shapes left out of the flow)");
          out.children[at] = compactFigma(rect);
          it.o = out.children[at]; it.c = rect; it.b = rect.absoluteBoundingBox;
        }
      }
      const bgItems = items.filter(isBg);
      bgItems.forEach((it) => { it.o.isParentBackground = true; });
      const boxed = items.filter((it) => it.b && !bgItems.includes(it));
      if (boxed.length > 1) out.children = [...bgItems.map((it) => it.o), ...xyCut(boxed), ...items.filter((it) => !it.b).map((it) => it.o)];
    }
  }
  return out;
}
// Descriptions cut to their first sentence; root description dropped (rules cover it).
function compactSchemaText(raw) {
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === "$schema" || k === "$id" || k === "title") continue;
        if (k === "description" && typeof v === "string") { out[k] = v.split(/(?<=[.!?])\s/)[0].slice(0, 110); continue; }
        out[k] = strip(v);
      }
      return out;
    }
    return o;
  };
  const j = strip(JSON.parse(raw));
  delete j.description;
  return JSON.stringify(j);
}
const COMPACT_RULES = `Output ONE JSON object valid for the schema. No markdown, no commentary.
- Every number comes from the Figma data (box = [x,y,w,h] px; colors already hex). Never estimate from the screenshot; it only confirms grouping/hierarchy (row vs stack).
- Code fills in sizes, gaps, margins, padding, text styling and button colours from the Figma data AFTER you answer. Get type, nesting, ids, exact text and assets right; leave out layout/size numbers you are unsure about.
- Value missing from data: omit the key, add a short string to root "_uncertain".
- No Bricks/Elementor/WordPress terms, element ids, attachment ids or CSS classes.
- Gradients: for a node listed in PRECOMPUTED GRADIENTS copy its "gradient" object verbatim into background.gradient (appliesTo:"background") or typography.colorGradient (appliesTo:"text"). Other gradient types, strokes, effects, absolute positioning, animation, forms, tabs go in that node's "notes" array; type "unsupported" only for whole elements with no equivalent.
- No responsive overrides unless Figma has explicit tablet/mobile frames.
- "id": unique kebab-case slug; "figmaNodeId": the Figma id.
- Images/icons: use nodeIds from the asset manifest. A node with "asset":true was pruned to one exported graphic: emit one image-type element for it.
- ONLY emit elements for nodes present in the Figma data below (one element per visible node, descendants nested). The screenshot may show other parts of the page: ignore them. Never invent text, ids, sections or content seen only in the screenshot.
- Leaf types heading, text, text-basic, button, image, icon, spacer, unsupported MUST NOT have "children" (an icon inside a button goes in the button's "notes", or use a row containing the text/button and the icon). heading/text/text-basic/button REQUIRE "text"; image/icon REQUIRE "asset".
- A node with "imageExported":false has an image fill but NO exported file: do not emit an image/icon with an asset for it (validation fails). Describe it in the parent's or its own "notes" instead.
- Loose layers (no auto-layout) are pre-grouped by geometry into {"g":"row"|"column","gaps":[measured px between consecutive children],"children":[...]} objects. Each g object is a row/column element (g is not a Figma node: no figmaNodeId; do not invent one); use its "gaps" for gap/margin, never estimate spacing. If a node's only child is a g object, that g is the node's own layout (no extra wrapper). Where a child has "offCross", that is its measured px offset from the row's top (or the column's left) edge: apply it as margin-top/margin-left. Keep the given order. "overlapping" means layers overlap: emit them in order and note it.
- Keep line breaks (\n) in "text" exactly as given.
- Colors may be #RRGGBBAA: keep the alpha in the hex.
- Typography values (lineHeight, letterSpacing) are already unit-qualified strings: copy them as given.`;

// A "turn" is { role: "user"|"assistant", content }, where content is either a plain
// string (every retry turn - always text-only) or the neutral parts array built for the
// first turn: [{type:"text", text}, {type:"image", media_type, data}]. Each provider's
// call function converts that into its own wire format right before sending.
const asParts = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : content);

function toAnthropicContent(content) {
  return asParts(content).map((p) =>
    p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.media_type, data: p.data } } : { type: "text", text: p.text }
  );
}
function toOpenAIContent(content) {
  return asParts(content).map((p) =>
    p.type === "image" ? { type: "image_url", image_url: { url: `data:${p.media_type};base64,${p.data}` } } : { type: "text", text: p.text }
  );
}

// Returns { text, finishReason } regardless of provider, so the retry loop in main()
// never needs to know which one it's talking to.
const usageTotal = { calls: 0, input: 0, output: 0 };
async function callAnthropic(turns, { model, maxTokens }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // A key that is not tied to one workspace needs the workspace id on every request (ANTHROPIC_WORKSPACE_ID in .env).
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {}) });
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: turns.map((t) => ({ role: t.role, content: toAnthropicContent(t.content) })),
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  // running token total for this run, from the numbers the API reports (what you are billed for)
  const u = response.usage || {};
  usageTotal.calls++; usageTotal.input += u.input_tokens || 0; usageTotal.output += u.output_tokens || 0;
  const pIn = Number(process.env.PRICE_IN_PER_MTOK), pOut = Number(process.env.PRICE_OUT_PER_MTOK);
  console.log(`  Tokens this call: ${(u.input_tokens || 0).toLocaleString()} in / ${(u.output_tokens || 0).toLocaleString()} out | run total (${usageTotal.calls} calls): ${usageTotal.input.toLocaleString()} in / ${usageTotal.output.toLocaleString()} out${pIn > 0 && pOut > 0 ? ` = ~$${((usageTotal.input * pIn + usageTotal.output * pOut) / 1e6).toFixed(4)}` : ""}`);
  return { text, finishReason: response.stop_reason };
}

// Free-tier Groq models, in fallback order. `vision: true` means it can actually see the
// screenshot (as of this writing only the Llama 4 family does on Groq's free tier -
// Maverick needs separate account access, hence Scout being tried first here). Every
// other model is text-only: if we fall through to one, the screenshot gets DROPPED from
// the request (sending an image to a text-only model just errors) and that's logged
// loudly, since losing visual context for grouping/hierarchy is a real quality hit, not
// a free substitution. maxTokens is kept under each model's published TPM so a single
// request doesn't get rejected for being too large on its own, independent of whether
// rate limits from EARLIER calls this minute have already been used up.
const GROQ_FALLBACK_MODELS = [
  // Best choice for Figma -> Bricks: multimodal, so it can see the screenshot.
  { model: "qwen/qwen3.8-27b", vision: true, maxTokens: 8000 },
  // Previous Qwen multimodal model (skipped automatically if your key can't see it).
  { model: "qwen/qwen3.6-27b", vision: true, maxTokens: 8000 },
  // Strong text-only fallback.
  { model: "openai/gpt-oss-120b", vision: false, maxTokens: 4000 },
  // Smaller text-only fallback.
  { model: "openai/gpt-oss-20b", vision: false, maxTokens: 4000 },
  { model: "llama-3.3-70b-versatile", vision: false, maxTokens: 4000 },
  { model: "llama-3.1-8b-instant", vision: false, maxTokens: 3000 },
];

function stripImages(turns) {
  return turns.map((t) => ({
    ...t,
    content: typeof t.content === "string" ? t.content : asParts(t.content).filter((p) => p.type !== "image"),
  }));
}

// Ask Groq which models THIS key can actually use, so we never burn a call on a 404.
async function listGroqModels(apiKey) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return new Set((data.data || []).filter((m) => m.active !== false).map((m) => m.id));
  } catch {
    return null;
  }
}

// Rough token estimate (JSON-heavy text is ~3 chars/token; images ~1.5k tokens flat).
function estimateTokens(turns) {
  let chars = 0, images = 0;
  for (const t of turns) for (const p of asParts(t.content)) p.type === "image" ? images++ : (chars += p.text.length);
  return Math.ceil(chars / 3) + images * 1500;
}

let groqJsonMode = process.env.GROQ_JSON_MODE !== "0";
async function groqRequest(apiKey, model, turns, maxTokens, retried = false) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // gpt-oss models are reasoning models: with a small output cap the hidden reasoning eats the whole budget and the
      // answer comes back empty (json_validate_failed). Keep the reasoning short.
      ...(/gpt-oss/i.test(model) ? { reasoning_effort: "low" } : {}),
      ...(groqJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: turns.map((t) => ({ role: t.role, content: toOpenAIContent(t.content) })),
    }),
  });
  if (!res.ok && res.status === 400) {
    const body = await res.clone().text();
    // JSON mode rejected the model's own (malformed) output: hand that text back so it can be repaired locally.
    if (body.includes("json_validate_failed")) {
      try {
        const fg = JSON.parse(body)?.error?.failed_generation;
        if (fg) { console.warn("  Groq JSON mode flagged malformed output - repairing locally."); return { text: fg, finishReason: "json_failed" }; }
      } catch {}
    }
    // This model doesn't support JSON mode: switch it off and retry once.
    if (groqJsonMode && /response_format|json mode|json_object/i.test(body)) {
      console.warn("  model rejected JSON mode - retrying without it.");
      groqJsonMode = false;
      return groqRequest(apiKey, model, turns, maxTokens, retried);
    }
  }
  if (!res.ok && res.status === 429 && !retried && !(await res.clone().text()).includes("Request too large")) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 20, 65);
    console.warn(`  rate limited (429), waiting ${wait}s and retrying once...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return groqRequest(apiKey, model, turns, maxTokens, true);
  }
  if (!res.ok) {
    const err = new Error(`Groq API ${res.status}: ${(await res.text()).slice(0, 700)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return { text: choice?.message?.content ?? "", finishReason: choice?.finish_reason };
}

// Module-level so once a working model is found, every later retry attempt in this run
// (the JSON-validation retry loop in main()) reuses it instead of re-discovering from
// scratch - avoids burning through the fallback list's rate limits twice for one run.
let workingGroqModel = null;
let workingGroqNoImage = false;
const groqBad = new Set();   // models that refused something this run (too large, no access...): not asked again
const groqOutLimit = new Map(); // model -> output-tokens-per-minute limit learned from a 429 ("OTPM: Limit 1000")
let groqLastCap = Infinity;     // the max_tokens the most recent Groq call was allowed to use (so callers can tell if a cut-off was due to the cap)
let groqChainCache = null;

async function callGroq(turns, { model: forcedModel }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("Missing GROQ_API_KEY in .env (AI_PROVIDER is set to groq, or was auto-detected from it).");
    process.exit(1);
  }

  // GROQ_MODEL in .env forces one specific model, no fallback - an explicit choice wins.
  if (forcedModel) return groqRequest(apiKey, forcedModel, turns, Number(process.env.AI_MAX_TOKENS) || 8000);

  if (!groqChainCache) {
    const available = await listGroqModels(apiKey);
    if (available) {
      console.log(`Models your Groq key can use: ${[...available].filter((m) => !/whisper|tts|guard|orpheus|playai/i.test(m)).join(", ")}`);
    }
    // Known-good entries first (only those the key can see), then any other available chat
    // model as a text-only last resort, so a renamed/new model still gets tried.
    const known = new Set(GROQ_FALLBACK_MODELS.map((m) => m.model));
    groqChainCache = available
      ? [
          ...GROQ_FALLBACK_MODELS.filter((m) => available.has(m.model)),
          ...[...available]
            .filter((id) => !known.has(id) && !/whisper|tts|guard|orpheus|playai|embed|safeguard/i.test(id))
            .map((id) => ({ model: id, vision: /qwen\/qwen3\.(6|8)-27b|vision|scout|maverick/i.test(id), maxTokens: 3000 })),
        ]
      : GROQ_FALLBACK_MODELS;
  }
  if (groqChainCache.length === 0) throw new Error("Your Groq key can't see any chat models. Check the key / org at console.groq.com.");
  const approxTokens = estimateTokens(stripImages(turns));
  console.log(`Estimated prompt size: ~${approxTokens.toLocaleString()} tokens (text only).`);
  const GROQ_TPM_LIMIT = Number(process.env.GROQ_TPM_LIMIT || 7800); // free tier: 7,000-8,000 tokens per request/minute
  if (approxTokens > GROQ_TPM_LIMIT) {
    throw new Error(
      `This section's prompt (~${approxTokens.toLocaleString()} tokens) is larger than the Groq free tier allows per request (~${GROQ_TPM_LIMIT.toLocaleString()}), so every model would refuse it.\n` +
        `Split it into smaller sections: run this stage with fewer --nodes (e.g. the navigation on its own, the headline block on its own) and merge them afterwards.\n` +
        `If you have a paid Groq tier, set GROQ_TPM_LIMIT=20000 in .env to skip this check.`
    );
  }
  // The model that worked last goes first; anything that refused earlier this run is skipped.
  const chain = [...groqChainCache].filter((m) => !groqBad.has(m.model)).sort((x, y) => (y.model === workingGroqModel) - (x.model === workingGroqModel));
  // Free-tier limits count the prompt AND the answer against the same per-minute budget: cap the answer to what is left.
  const outCap = (entry) => {
    const base = Math.max(1000, Math.min(entry.maxTokens, GROQ_TPM_LIMIT - approxTokens - 300));
    const learned = groqOutLimit.get(entry.model);
    return learned ? Math.max(200, Math.min(base, learned - 50)) : base;
  };
  // A 429 about OUTPUT tokens per minute is a limit on max_tokens, not on the prompt: lower max_tokens under it and retry the SAME model.
  const requestWithOtpmRetry = async (entry, useT) => {
    try {
      groqLastCap = outCap(entry);
      return await groqRequest(apiKey, entry.model, useT, groqLastCap);
    } catch (e) {
      const m = /OTPM\)?:?\s*Limit\s+(\d+)/i.exec(e.message || "");
      if (e.status === 429 && m) {
        const lim = Number(m[1]);
        groqOutLimit.set(entry.model, lim);
        groqLastCap = Math.max(200, lim - 50);
        console.warn(`  ${entry.model} allows only ${lim} output tokens per request/minute on your Groq tier - retrying with max_tokens=${groqLastCap} (long answers will be cut off and re-split automatically).`);
        return await groqRequest(apiKey, entry.model, useT, groqLastCap);
      }
      throw e;
    }
  };
  const failures = [];
  for (const entry of chain) {
    const useTurns = entry.vision && !workingGroqNoImage ? turns : stripImages(turns);
    if (entry.model !== workingGroqModel) {
      if (!entry.vision) console.warn(`Trying ${entry.model} (TEXT-ONLY - screenshot dropped, model can't see the design, only the Figma data).`);
      else console.log(`Trying ${entry.model} (vision)...`);
    }
    try {
      let result;
      try {
        result = await requestWithOtpmRetry(entry, useTurns);
      } catch (e) {
        // Too large with the screenshot attached: same (vision) model, text only, before moving on.
        if (e.status === 413 && entry.vision && useTurns !== undefined && !workingGroqNoImage) {
          console.warn(`  413 with screenshot - retrying ${entry.model} WITHOUT the screenshot (still a stronger model than the text-only fallbacks)...`);
          result = await requestWithOtpmRetry(entry, stripImages(turns));
          workingGroqNoImage = true;
        } else throw e;
      }
      if (workingGroqModel !== entry.model) console.log(`Using ${entry.model}.`);
      workingGroqModel = entry.model;
      return result;
    } catch (e) {
      failures.push(`${entry.model}: ${e.message.slice(0, 400)}`);
      console.warn(`  failed (${e.status ?? "?"}): ${e.message.replace(/^Groq API \d+: /, "").slice(0, 300)}`);
      // "Request too large" (413, or a 429 about this one request exceeding the limit) and access errors will not get better on retry.
      if (e.status === 413 || e.status === 403 || e.status === 404 || /Request too large|reduce max_tokens/i.test(e.message)) {
        groqBad.add(entry.model);
        console.warn(`  (not using ${entry.model} again in this run)`);
      }
      if (workingGroqModel === entry.model) workingGroqModel = null;
    }
  }
  throw new Error(`All Groq fallback models failed:\n${failures.join("\n")}`);
}

// ---- Gemini (Google AI Studio free tier, OpenAI-compatible endpoint) ----------------
// Free tier has a large context window, so whole sections fit without splitting.
// Model ids and free-tier limits change: check https://ai.google.dev/gemini-api/docs/models
async function callGemini(turns, { model, maxTokens }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY in .env (free key: https://aistudio.google.com/apikey).");
    process.exit(1);
  }
  // Busy/overloaded (503) and rate limits (429) are usually temporary: retry each model several times with growing waits,
  // then fall through to GEMINI_FALLBACK_MODELS (comma separated, optional) before giving up.
  const models = [model, ...String(process.env.GEMINI_FALLBACK_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean)];
  const MAX_TRIES = Number(process.env.GEMINI_RETRIES) || 6;
  let lastErr;
  for (const m of models) {
    const body = JSON.stringify({
      model: m,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: turns.map((t) => ({ role: t.role, content: toOpenAIContent(t.content) })),
    });
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        const choice = data.choices?.[0];
        if (m !== model) console.log(`  (answered by fallback model ${m})`);
        return { text: choice?.message?.content ?? "", finishReason: choice?.finish_reason };
      }
      const errText = (await res.text()).slice(0, 700);
      lastErr = new Error(`Gemini API ${res.status} (${m}): ${errText}`);
      lastErr.status = res.status;
      if ((res.status === 429 || res.status === 503 || res.status === 500) && attempt < MAX_TRIES) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 20 * attempt, 90);
        console.warn(`  Gemini ${res.status} on ${m} (busy), waiting ${wait}s and retrying (${attempt}/${MAX_TRIES})...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if ([404, 429, 500, 503].includes(res.status) && m !== models[models.length - 1]) { console.warn(`  ${m} unavailable (${res.status}) - trying the next model...`); break; }
      throw lastErr;
    }
  }
  throw lastErr;
}

// ---- Ollama (local). Uses the native API so num_ctx can be set: the default context
// (2-4k tokens) would silently truncate your prompt. Text-only: screenshot is dropped.
async function callOllama(turns, { model, maxTokens }) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const numCtx = Number(process.env.OLLAMA_NUM_CTX) || 16384;
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { num_ctx: numCtx, num_predict: maxTokens, temperature: 0 },
      messages: stripImages(turns).map((t) => ({
        role: t.role,
        content: asParts(t.content).map((p) => p.text).join("\n"),
      })),
    }),
  });
  if (!res.ok) {
    const err = new Error(`Ollama API ${res.status}: ${(await res.text()).slice(0, 700)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { text: data.message?.content ?? "", finishReason: data.done_reason === "length" ? "length" : data.done_reason };
}

// ---- NVIDIA API Catalog (build.nvidia.com, OpenAI-compatible, free credits for prototyping) ------
// .env: AI_PROVIDER=nvidia  NVIDIA_API_KEY=nvapi-...  NVIDIA_MODEL=<model id from build.nvidia.com>
// Optional: NVIDIA_BASE_URL (default https://integrate.api.nvidia.com/v1), NVIDIA_VISION=1 to send the screenshot
// (only for a vision model; it is dropped by default because most text models reject images).
async function callNvidia(turns, { model, maxTokens }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error("Missing NVIDIA_API_KEY in .env (free key: https://build.nvidia.com).");
    process.exit(1);
  }
  const base = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  // Models get retired often (404/410): try the next one. Override with NVIDIA_FALLBACK_MODELS=id1,id2
  const fallbacks = process.env.NVIDIA_FALLBACK_MODELS !== undefined
    ? process.env.NVIDIA_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : ["nvidia/llama-3.1-nemotron-70b-instruct", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "nvidia/nemotron-3-super-120b-a12b", "nvidia/llama-3.1-nemotron-ultra-253b-v1"];
  const models = [model, ...fallbacks.filter((m) => m !== model)];
  const MAX_TRIES = Number(process.env.NVIDIA_RETRIES) || 5;
  let lastErr;
  for (const [mi, m] of models.entries()) {
    const useImages = process.env.NVIDIA_VISION === "1" || /vision|vlm|-vl|llava|pixtral|paligemma/i.test(m);
    const sendTurns = useImages ? turns : stripImages(turns);
    const stream = process.env.NVIDIA_STREAM !== "0"; // streaming keeps the connection alive during long generations (plain requests get cut with ECONNRESET)
    const body = JSON.stringify({
      model: m,
      max_tokens: maxTokens,
      temperature: 0,
      ...(stream ? { stream: true } : {}),
      messages: sendTurns.map((t) => ({ role: t.role, content: useImages ? toOpenAIContent(t.content) : asParts(t.content).map((p) => p.text).join("\n") })),
    });
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      let res;
      const t0 = Date.now();
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(stream ? { Accept: "text/event-stream" } : {}) },
          body,
        });
        if (res.ok) {
          let text = "", finish = null;
          if (stream) {
            let buf = "", got = 0;
            for await (const chunk of res.body) {
              buf += chunk.toString("utf8");
              let nlPos;
              while ((nlPos = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nlPos).trim();
                buf = buf.slice(nlPos + 1);
                if (!line.startsWith("data:")) continue;
                const d = line.slice(5).trim();
                if (!d || d === "[DONE]") continue;
                try {
                  const c = JSON.parse(d).choices?.[0];
                  const piece = c?.delta?.content ?? "";
                  if (piece) { text += piece; got++; if (got % 400 === 0) console.log(`  ...receiving (${text.length.toLocaleString()} chars so far, ${Math.round((Date.now() - t0) / 1000)}s)`); }
                  if (c?.finish_reason) finish = c.finish_reason;
                } catch {}
              }
            }
          } else {
            const data = await res.json();
            text = data.choices?.[0]?.message?.content ?? "";
            finish = data.choices?.[0]?.finish_reason;
          }
          if (mi > 0) console.log(`  (answered by NVIDIA model ${m})`);
          return { text: text.replace(/<think>[\s\S]*?<\/think>/g, ""), finishReason: finish };
        }
      } catch (netErr) {
        // connection dropped (ECONNRESET, timeout, DNS...): retry this model, then move on to the next one
        lastErr = new Error(`NVIDIA network error (${m}): ${netErr.message}`);
        console.warn(`  NVIDIA connection problem on ${m} after ${Math.round((Date.now() - t0) / 1000)}s (${netErr.code || netErr.message.slice(0, 60)})`);
        if (attempt < 2) { console.warn("  retrying in 10s..."); await new Promise((r) => setTimeout(r, 10000)); continue; }
        if (mi < models.length - 1) { console.warn(`  trying ${models[mi + 1]}...`); break; }
        throw lastErr;
      }
      lastErr = new Error(`NVIDIA API ${res.status} (${m}): ${(await res.text()).slice(0, 500)}`);
      lastErr.status = res.status;
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_TRIES) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 15 * attempt, 90);
        console.warn(`  NVIDIA ${res.status} on ${m} (busy/rate limit), waiting ${wait}s and retrying (${attempt}/${MAX_TRIES})...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if ([400, 403, 404, 410, 422].includes(res.status) && mi < models.length - 1) { console.warn(`  NVIDIA model ${m} unavailable (${res.status}) - trying ${models[mi + 1]}...`); break; }
      throw lastErr;
    }
  }
  throw lastErr;
}

async function callOne(p, turns, opts) {
  if (p === "nvidia") return callNvidia(turns, opts);
  if (p === "gemini") return callGemini(turns, opts);
  if (p === "ollama") return callOllama(turns, opts);
  return p === "groq" ? callGroq(turns, opts) : callAnthropic(turns, opts);
}

const deadProviders = new Set(); // providers that failed earlier in this run (when another one is available): not retried for every part
async function callModel(turns, _opts) {
  const errors = [];
  const live = CHAIN.filter((p) => !deadProviders.has(p));
  const order = live.length ? live : CHAIN;
  for (const [i, p] of order.entries()) {
    try {
      if (order.length > 1) console.log(`Provider ${i + 1}/${order.length}: ${p}  Model: ${modelFor(p) || "auto (fallback chain)"}`);
      const out = await callOne(p, turns, { model: modelFor(p), maxTokens: maxTokensFor(p) });
      activeProvider = p;
      return out;
    } catch (e) {
      errors.push(`${p}: ${String(e.message).slice(0, 300)}`);
      if (i < order.length - 1) {
        deadProviders.add(p);
        console.warn(`  ${p} failed (${String(e.message).replace(/\s+/g, " ").slice(0, 160)}) - switching to ${order[i + 1]} (and skipping ${p} for the rest of this run)...`);
      }
    }
  }
  const err = new Error(`All providers failed:\n${errors.map((x) => "  - " + x).join("\n")}`);
  err.status = 503;
  throw err;
}

// Minified: the schema is ~11k chars pretty-printed; whitespace is pure token waste.
const SCHEMA_OBJ = JSON.parse(fs.readFileSync("schema/normalized-schema.json", "utf-8"));
// The schema file accepts border colour/width (set by code from the Figma stroke), but the model is shown the original radius-only border:
// it must not try to fill those in, and keeping the prompt text unchanged keeps every saved part (--resume) valid.
const PROMPT_BORDER = { type: "object", additionalProperties: false, description: "Only uniform corner radius is supported so far. Strokes and per-corner radii go in `notes`.", properties: { radius: { type: "number", minimum: 0 } } };
const promptSchemaObj = () => { const o = JSON.parse(JSON.stringify(SCHEMA_OBJ)); o.definitions.border = PROMPT_BORDER; delete o.definitions.typography.properties.textTransform; return o; };
const NORMALIZED_SCHEMA = JSON.stringify(promptSchemaObj());

// Shrink Figma node JSON for the prompt without changing any meaningful value: round
// floats, drop nulls/empties and keys that never affect layout/styling.
const NOISE_KEYS = new Set(["constraints", "scrollBehavior", "layoutVersion", "exportSettings", "interactions", "transitionNodeID", "transitionDuration", "transitionEasing", "pluginData", "sharedPluginData", "boundVariables", "inferredVariables", "componentPropertyReferences", "styles", "isMask", "isMaskOutline", "maskType", "layoutPositioning"]);
function slimFigma(v) {
  if (Array.isArray(v)) return v.map(slimFigma).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (NOISE_KEYS.has(k)) continue;
      if (k === "blendMode" && (val === "PASS_THROUGH" || val === "NORMAL")) continue;
      if (k === "visible" && val === true) continue;
      if (k === "opacity" && val === 1) continue;
      const sv = slimFigma(val);
      if (sv === undefined || sv === null || (Array.isArray(sv) && !sv.length) || (typeof sv === "object" && !Array.isArray(sv) && !Object.keys(sv).length)) continue;
      out[k] = sv;
    }
    return out;
  }
  if (typeof v === "number") return Math.round(v * 100) / 100;
  return v;
}

const NORMALIZED_SCHEMA_DOC = `
Output must be ONE JSON object that validates against this JSON Schema (it is the
single source of truth; field descriptions inside it are binding):

${NORMALIZED_SCHEMA}

Rules:
- Every numeric value MUST come from the Figma node data provided. Never estimate sizes, colors or spacing from the screenshot.
- The screenshot is only for confirming visual intent (grouping, hierarchy, whether a set of items is really a row or a stack).
- If a value is absent from the Figma data, omit the key and add a short entry to the root "_uncertain" array. Do not guess.
- Do not output Bricks, Elementor or WordPress terms, element ids, attachment ids or CSS class names.
- Linear gradients ARE supported: background.gradient for fills, typography.colorGradient for gradient text. See "PRECOMPUTED GRADIENTS" below - use those exact values verbatim for the listed nodeIds, do not compute your own angle or stop positions from gradientHandlePositions (that math is done deterministically outside this prompt so it's correct every time). Any gradient NOT in that precomputed list (radial, angular/conic, or a linear gradient missing handle data) is not supported - put it in that node's "notes" array instead.
- Anything else the schema cannot express (strokes, glows, absolute positioning, animation, accordions, tabs, forms) goes in that node's "notes" array. Use type "unsupported" only for whole elements with no equivalent type.
- Do not invent responsive overrides. Only fill "responsive" when the Figma file contains explicit tablet/mobile frames for the node.
- "id" values are unique semantic kebab-case slugs. Put the Figma node id in "figmaNodeId".
- Include asset nodes (images, icons) using the nodeId values that appear in the asset manifest provided.
- A Figma node with a "_note" field starting "pruned from prompt" has had its children/geometry deliberately removed before reaching you - it is a single icon/illustration/logo asset. Represent it as one image-type element using its id to look up the file in the asset manifest. Its absoluteBoundingBox is still accurate and present.
`.trim();

const COMPACT_SCHEMA_DOC = `JSON Schema for the output (field descriptions are binding):\n${compactSchemaText(JSON.stringify(promptSchemaObj()))}\n\n${COMPACT_RULES}`;

// Each examples/<name>/ folder should hold a verified pair:
//   figma-node.json   raw Figma node data (stage 1 output)
//   normalized.json   the CORRECT normalized output for it (hand-checked, passes normalized-validator)
// bricks-export.json is optional extra context and is not what the model is asked to produce.
function loadExamples() {
  const examplesDir = "examples";
  if (!fs.existsSync(examplesDir)) return [];
  const pairs = [];
  for (const dir of fs.readdirSync(examplesDir)) {
    const full = path.join(examplesDir, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    const figmaPath = path.join(full, "figma-node.json");
    const normPath = path.join(full, "normalized.json");
    if (!fs.existsSync(figmaPath)) continue;
    if (!fs.existsSync(normPath)) {
      console.warn(`examples/${dir}: has figma-node.json but no normalized.json — skipped (the model needs Figma -> normalized pairs).`);
      continue;
    }
    pairs.push({
      name: dir,
      figma: fs.readFileSync(figmaPath, "utf-8"),
      normalized: fs.readFileSync(normPath, "utf-8"),
    });
  }
  return pairs;
}

// In scoped runs the screenshot is the whole page, which invites the model to describe
// sections that aren't in scope. Crop it to the scoped nodes' bounding box (and cap width to
// ~1024px to save tokens). Needs the optional "sharp" package; falls back to the full image.
async function cropScreenshotToScope(imgBuf, fullRoot, scopedRoot) {
  let sharp;
  try { sharp = (await import("sharp")).default; } catch { return { buf: null, why: 'install it with "npm i sharp" to crop the screenshot to the scoped nodes' }; }
  const rb = fullRoot.absoluteBoundingBox;
  const boxes = (scopedRoot.children || []).map((c) => c.absoluteBoundingBox).filter(Boolean);
  if (!rb || !boxes.length) return { buf: null, why: "no bounding boxes" };
  const meta = await sharp(imgBuf).metadata();
  const scale = meta.width / rb.width;
  if (Math.abs(meta.height / rb.height - scale) / scale > 0.03) return { buf: null, why: "screenshot size doesn't match the frame's aspect ratio" };
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const left = Math.max(0, Math.floor((x0 - rb.x) * scale)), top = Math.max(0, Math.floor((y0 - rb.y) * scale));
  const width = Math.min(meta.width - left, Math.ceil((x1 - x0) * scale)), height = Math.min(meta.height - top, Math.ceil((y1 - y0) * scale));
  if (width < 16 || height < 16) return { buf: null, why: "crop region too small" };
  const buf = await sharp(imgBuf).extract({ left, top, width, height }).resize({ width: 1024, withoutEnlargement: true }).png().toBuffer();
  return { buf, why: `cropped to ${width}x${height}px region` };
}

// ---- Structure check: does the model's nesting match the measured layout groups? ----------
function hintLeafIds(n, acc = new Set()) {
  if (!n || typeof n !== "object") return acc;
  if (!n.g && n.id) acc.add(n.id);
  for (const c of n.children || []) hintLeafIds(c, acc);
  return acc;
}
function hintGroups(n, acc = []) {
  if (!n || typeof n !== "object") return acc;
  if (n.g && n.g !== "overlapping") acc.push(n);
  for (const c of n.children || []) hintGroups(c, acc);
  return acc;
}
function hintSummary(n) {
  if (!n.g) return n.id;
  return { g: n.g, ...(n.gaps ? { gaps: n.gaps } : {}), children: n.children.map(hintSummary) };
}
function structureProblems(hintRoot, normalized) {
  const parentOf = new Map();
  const byId = new Map();
  (function walk(n, p) {
    if (n.figmaNodeId && !byId.has(n.figmaNodeId)) byId.set(n.figmaNodeId, n);
    parentOf.set(n, p);
    for (const c of n.children || []) walk(c, n);
  })({ children: normalized.children || [] }, null);
  const subtreeIds = (n, acc = new Set()) => {
    if (n.figmaNodeId) acc.add(n.figmaNodeId);
    for (const c of n.children || []) subtreeIds(c, acc);
    return acc;
  };
  const problems = [];
  for (const g of hintGroups(hintRoot)) {
    const sets = g.children.map((c) => [...hintLeafIds(c)].filter((id) => byId.has(id)));
    if (sets.filter((x) => x.length).length < 2) continue;
    const els = sets.map((ids) => {
      if (!ids.length) return null;
      let el = byId.get(ids[0]);
      while (el && !ids.every((id) => subtreeIds(el).has(id))) el = parentOf.get(el);
      return el;
    });
    const label = (ids) => `[${ids.join(", ")}]`;
    outer: for (let i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      const inside = subtreeIds(els[i]);
      for (let j = 0; j < els.length; j++) {
        if (i === j || !sets[j].length) continue;
        if (sets[j].some((id) => inside.has(id))) {
          problems.push(`Layout: in the measured ${g.g}, ${label(sets[i])} and ${label(sets[j])} are separate ${g.g === "row" ? "side-by-side" : "stacked"} items, so they must be SIBLING elements. ${label(sets[j])} must not be nested inside the element holding ${label(sets[i])}.`);
          break outer;
        }
      }
    }
    const parents = new Set(els.filter(Boolean).map((e) => parentOf.get(e)));
    if (parents.size > 1 && !problems.length) problems.push(`Layout: the ${g.g} items ${sets.filter((x) => x.length).map(label).join(" and ")} must share the same parent element.`);
  }
  return problems.slice(0, 6);
}

// ---- Coverage check: every visible TEXT node and exported asset must be represented in the output ----------
// A text node counts as covered if its id appears OR its characters appear inside any output element's
// "text" (a button carries its label in its own text field and may not have children). An asset inside an
// element emitted as a button is folded into that button and counts as covered too.
function coverageProblems(hintRoot, normalized) {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const have = new Set(), ownerType = new Map(), texts = [];
  (function walk(n) {
    if (n.figmaNodeId) { have.add(n.figmaNodeId); ownerType.set(n.figmaNodeId, n.type); }
    if (n.asset?.nodeId) have.add(n.asset.nodeId);
    if (typeof n.text === "string") texts.push(norm(n.text));
    for (const c of n.children || []) walk(c);
  })({ children: normalized.children || [] });
  const need = [];
  (function walk(n, anc) {
    if (!n || typeof n !== "object") return;
    const foldedIntoButton = anc.some((id) => ownerType.get(id) === "button");
    if (!n.g && n.id && !foldedIntoButton) {
      if (n.type === "TEXT") {
        const t = norm(n.characters || n.name);
        if (!have.has(n.id) && !texts.some((x) => x.includes(t))) need.push({ id: n.id, name: t, text: true });
      } else if (n.asset && !have.has(n.id)) need.push({ id: n.id, name: n.name || "", text: false });
    }
    for (const c of n.children || []) walk(c, n.id ? [...anc, n.id] : anc);
  })(hintRoot, []);
  if (!need.length) return [];
  const list = need.slice(0, 8).map((x) => `${x.id} (${x.text ? "text" : "asset"}: ${String(x.name).slice(0, 40)})`).join(", ");
  return [`Coverage: ${need.length} content node(s) from the Figma data are missing from your output: ${list}. Emit each as a heading/text/image element with that figmaNodeId (button labels belong in the button's own "text", never as a child).`];
}

async function main() {
  const figmaNodePath = path.join(frameDir, "figma-node.json");
  const screenshotPath = path.join(frameDir, "screenshot.png");
  if (!fs.existsSync(figmaNodePath)) {
    console.error(`Missing ${figmaNodePath} — run stage 1 first.`);
    process.exit(1);
  }

  const fullRoot = JSON.parse(fs.readFileSync(figmaNodePath, "utf-8"));
  let scopedRoot = fullRoot;
  let outSubdir = "";
  if (scopeIds) {
    scopedRoot = buildScopedRoot(fullRoot, scopeIds);
    outSubdir = path.join("sections", scopeName ? slugify(scopeName) : slugify(scopedRoot.children.map((c) => c.name).join("-")));
    console.log(`Scoped to ${scopeIds.length} node(s): ${scopedRoot.children.map((c) => `${c.id} (${c.name})`).join(", ")}`);
    console.log(`Scoped output will go to ${path.join(frameDir, outSubdir)}/ (the full-page figma-node.json / screenshot.png are untouched).`);
  }
  const outDir = outSubdir ? path.join(frameDir, outSubdir) : frameDir;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "normalized.json");

  const allGradients = collectGradients(scopedRoot);
  const rawSize = JSON.stringify(scopedRoot).length;
  const pruneStats = { count: 0, charsSaved: 0 };
  const prunedRoot = pruneGraphics(scopedRoot, pruneStats);
  // Gradients inside a pruned illustration/icon are baked into its exported image - the model never needs them.
  const gradients = allGradients.filter((g) => !pruneStats.prunedIds?.has(g.nodeId));
  if (gradients.length) {
    console.log(`Precomputed ${gradients.length} linear gradient(s) deterministically (angle + stops already converted - the model is told to copy these, not recalculate them).`);
  }
  if (allGradients.length > gradients.length) {
    console.log(`Left out ${allGradients.length - gradients.length} gradient(s) that sit inside exported graphics (already part of those images).`);
  }
  // Compact mode also feeds the measured-layout hints that drive the nesting repair and coverage checks, so keep it on for every provider
  // (Gemini/Ollama simply have room to spare; the size limit check still only applies to Groq). AI_COMPACT=0 turns it off (not with --split).
  const compact = process.env.AI_COMPACT !== "0" || SPLIT;
  if (pruneStats.count > 0) {
    const pct = Math.round((pruneStats.charsSaved / rawSize) * 100);
    console.log(
      `Pruned ${pruneStats.count} graphic subtree(s) (icons/illustrations) out of the prompt - they're already exported assets, not something the model needs raw vector data for. Saved ~${pruneStats.charsSaved.toLocaleString()} chars (${pct}% of the raw JSON size).`
    );
  }
  const manifestPath = path.join(frameDir, "asset-manifest.json");
  const fullManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : [];
  // Only assets for nodes that are still in the prompt: pruned graphics stay as stubs (their own id), but the files
  // for everything inside them are part of that one exported image and just waste prompt tokens.
  const promptIds = collectIds(prunedRoot);
  const manifest = fullManifest.filter((m) => promptIds.has(m.nodeId) && (!pruneStats.prunedIds?.has(m.nodeId) || prunedStubIds(prunedRoot).has(m.nodeId)));
  if (scopeIds) console.log(`Asset manifest trimmed to ${manifest.length}/${fullManifest.length} entries reachable from the scoped nodes.`);
  manifestIds = new Set(manifest.map((m) => m.nodeId));
  {
    const missing = [];
    (function walk(n) {
      if (n.visible === false) return;
      if (hasImageFill(n) && !manifestIds.has(n.id)) missing.push(`${n.id} (${n.name})`);
      for (const c of n.children || []) walk(c);
    })(scopedRoot);
    if (missing.length) {
      console.warn(`WARNING: image-fill node(s) with NO exported file in asset-manifest.json: ${missing.join(", ")}\n  Stage 1 didn't export these (failed/skipped). Re-run stage 1 or export them manually; until then they can only be described in "notes".`);
    }
  }
  const examples = loadExamples();
  console.log(`Loaded ${examples.length} example pair(s) from examples/`);
  if (examples.length === 0) {
    console.warn("WARNING: no examples found. Output quality will be much lower until you add real pairs — see examples/README.md.");
  }

  // Measured layout of the whole scope: drives the nesting repair, the post-processing and the stitching of split parts.
  const fullHint = compactFigma(prunedRoot);
  const measuredHint = compactMeasured(prunedRoot); // same tree + two-child card backgrounds; used to stitch and post-process, never for prompts
  if (process.argv.includes("--dump")) {
    fs.writeFileSync(path.join(outDir, "prompt-figma.json"), JSON.stringify(compact ? fullHint : JSON.parse(JSON.stringify(slimFigma(prunedRoot))), null, 2));
    console.log(`--dump: wrote ${path.join(outDir, "prompt-figma.json")} (exactly the Figma data the model receives)`);
  }
  if (compact) console.log("Compact prompt mode on: trimmed Figma keys, hex colors, short schema/rules. Set AI_COMPACT=0 to disable.");

  const screenshotFull = fs.existsSync(screenshotPath) ? fs.readFileSync(screenshotPath) : null;
  const gradientsFor = (root) => { const ids = collectIds(root); return gradients.filter((g) => ids.has(g.nodeId)); };
  const manifestFor = (root) => { const ids = collectIds(root); return manifest.filter((m) => ids.has(m.nodeId)); };

  // --estimate: tokens for the calls this run would make; the answer size is judged from the section's earlier normalized.json when there is one.
  function reportEstimate(inputs, { imagePerCall = 0, label = "" } = {}) {
    const inTok = inputs.reduce((a, b) => a + b, 0) + imagePerCall * inputs.length;
    let outTok, outNote;
    const prev = [outPath, outPath.replace(/normalized\.json$/, "normalized.rejected.json")].find((f) => fs.existsSync(f));
    if (prev) { outTok = Math.round(fs.readFileSync(prev, "utf-8").length / 3.2); outNote = `from the existing ${path.basename(prev)}`; }
    else { outTok = Math.round(inTok * 0.45); outNote = "guessed as 45% of the input (no earlier result to measure)"; }
    const pIn = Number(process.env.PRICE_IN_PER_MTOK), pOut = Number(process.env.PRICE_OUT_PER_MTOK);
    const line = "-".repeat(64);
    console.log(`\n${line}\nESTIMATE ${label} - nothing was sent to any model\n${line}`);
    console.log(`Model calls (best case, every answer valid): ${inputs.length}`);
    console.log(`Input tokens : ~${inTok.toLocaleString()}${imagePerCall ? ` (includes ~${imagePerCall} per screenshot)` : ""}`);
    console.log(`Output tokens: ~${outTok.toLocaleString()}  (${outNote})`);
    console.log(`If every part needs one repair call: input ~${(inTok * 2).toLocaleString()}, output ~${(outTok * 2).toLocaleString()} (worst case)`);
    if (pIn > 0 && pOut > 0) {
      const cost = (i, o) => (i * pIn + o * pOut) / 1e6;
      console.log(`Cost at $${pIn}/$${pOut} per million tokens: ~$${cost(inTok, outTok).toFixed(4)} (worst case ~$${cost(inTok * 2, outTok * 2).toFixed(4)})`);
    } else console.log("Set PRICE_IN_PER_MTOK and PRICE_OUT_PER_MTOK in .env (the model's prices per million tokens) to also see the cost in dollars.");
    console.log(`${line}\n`);
  }

  // Builds the whole prompt for `root` (the full scope, or one part of it).
  async function buildPrompt(root, part, withImage = true) {
    const hint = root === prunedRoot ? fullHint : compactFigma(root);
    const figmaNode = JSON.stringify(compact ? hint : slimFigma(root));
    const man = manifestFor(root);
    const manifestText = JSON.stringify(man);
    const gr = gradientsFor(root);
    const content = [];
    content.push({
      type: "text",
      text: compact && examples.length === 0 ? `Convert this Figma frame into the normalized design schema.\n\n${COMPACT_SCHEMA_DOC}` : `You are converting a Figma frame into a normalized, builder-agnostic design schema.

${compact ? COMPACT_SCHEMA_DOC : NORMALIZED_SCHEMA_DOC}
${examples.length ? `
Below are verified examples: raw Figma node data for a section, paired with the correct
normalized JSON for it. Follow their conventions exactly (slug ids, what goes in layout vs size,
how gaps/padding/typography are expressed, when notes are used).` : ""}`,
    });
    for (const ex of examples) {
      content.push({ type: "text", text: `\n--- EXAMPLE: ${ex.name} ---\nFigma node data:\n${ex.figma}` });
      content.push({ type: "text", text: `Correct normalized JSON for it:\n${ex.normalized}` });
    }
    const gradientsText = gr.length ? JSON.stringify(gr) : "(none found in this frame)";
    const scopeNote = part
      ? `\nNOTE: this is PART ${part.i} of ${part.n} of ONE larger section, sent in pieces because it is too big for a single request. Treat the top-level frame in the data as a synthetic wrapper: do NOT emit it. Emit ONE section element holding ONLY the nodes listed below, flat in the order given (the exact nesting is rebuilt from the measured layout afterwards, so do not try to guess a hierarchy that is not in the data). A frame node that has NO "children" key here is a container whose contents are handled in other parts: emit it as a "column" element (or "row" if its layoutMode is HORIZONTAL) with its figmaNodeId, keep its fills/border/radius, and give it NO children. Emit nothing that is not in the Figma data below.\n`
      : scopeIds
        ? `\nNOTE: this is a SCOPED SUBSET of the full page (${scopeIds.length} top-level node(s), selected for a focused test run) - treat it as a standalone section. The top-level frame in the data is a synthetic wrapper: do NOT emit it or copy its size; emit one section element holding the listed nodes. Any screenshot is only context; emit nothing that is not in the Figma data.\n`
        : "";
    content.push({
      type: "text",
      text: `\n--- NEW FRAME TO CONVERT ---${scopeNote}\nFigma node data:\n${figmaNode}\n\nAsset manifest (use these nodeId values for image/icon assets):\n${manifestText}\n\nPRECOMPUTED GRADIENTS (angle + stops already converted from Figma's raw gradientHandlePositions - copy the "gradient" object for a nodeId VERBATIM into that node's background.gradient (appliesTo:"background") or typography.colorGradient (appliesTo:"text"); do not recompute or round these values yourself):\n${gradientsText}\n\nProduce the normalized JSON for this frame now. Respond with ONLY the JSON object, no markdown fences, no commentary.`,
    });
    if (withImage && screenshotFull) {
      let imgBuf = screenshotFull;
      if (scopeIds || part) {
        try {
          const { buf, why } = await cropScreenshotToScope(imgBuf, fullRoot, root);
          if (buf) { imgBuf = buf; if (!part) console.log(`Screenshot ${why}.`); }
          else if (!part) console.warn(`Screenshot NOT cropped (${why}) - model sees the full page, so it may describe out-of-scope sections.`);
        } catch (e) {
          if (!part) console.warn(`Screenshot crop failed (${e.message}) - using the full page.`);
        }
      }
      content.push({ type: "image", media_type: "image/png", data: imgBuf.toString("base64") });
    }
    return { content, hint, man, manifestText };
  }

  let lastTruncated = false; // the last model answer was cut off at max_tokens
  // Ask the model about `root`, validate (retrying once), and return the validated (not yet post-processed) normalized JSON.
  async function ask(root, part) {
    const { content, hint: hintTree, man, manifestText } = await buildPrompt(root, part);
    if (ESTIMATE) { reportEstimate([estimateTokens([{ role: "user", content }])], { label: `for ${scopeName || path.basename(outDir)}` }); process.exit(0); }
    const model = modelFor(CHAIN[0]);
    const maxTokens = maxTokensFor(CHAIN[0]);
    if (!part) console.log(CHAIN.length > 1 ? `Providers (in order): ${CHAIN.map((p) => `${p} [${modelFor(p) || "auto"}]`).join(" -> ")}` : CHAIN[0] === "groq" ? `Provider: groq  Model: ${model || "auto (fallback chain)"}` : `Provider: ${CHAIN[0]}  Model: ${model}  max_tokens: ${maxTokens}`);
    let turns = [{ role: "user", content }];
    // Groq's per-minute token cap can't fit "whole prompt + bad answer + fix request", so on
    // retry send a small standalone repair prompt (schema + manifest + bad JSON + errors).
    const repairTurns = (bad, problems) => [{
      role: "user",
      content: `${COMPACT_SCHEMA_DOC}\n\nAsset manifest:\n${manifestText}${hintTree && hintGroups(hintTree).length ? `\n\nMEASURED LAYOUT (nesting the output must follow; g objects are row/column elements):\n${JSON.stringify(hintSummary(hintTree.children?.length === 1 ? hintTree.children[0] : { g: "column", children: hintTree.children || [] }))}` : ""}\n\nThe JSON below failed validation. Fix ONLY the listed problems and return the complete corrected JSON object, nothing else.\n\nPROBLEMS:\n${problems}\n\nJSON:\n${bad}`,
    }];
    const queueRetry = async (bad, problems, userMsg) => {
      if (activeProvider === "groq") {
        turns = repairTurns(bad, problems);
        console.log("Waiting 62s so Groq's per-minute token window resets before the repair call...");
        await new Promise((r) => setTimeout(r, 62000));
      } else {
        turns.push({ role: "assistant", content: bad });
        turns.push({ role: "user", content: userMsg });
      }
    };

    let parsed = null;
    let lastProblems = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`Calling LLM (attempt ${attempt}/2)${part ? ` for part ${part.i}/${part.n}` : ""}...`);
      const { text: rawText, finishReason } = await callModel(turns, { model, maxTokens });
      lastTruncated = finishReason === "length" || finishReason === "max_tokens";
      if (finishReason === "length" || finishReason === "max_tokens") {
        console.warn(`WARNING: response was cut off at max_tokens before finishing - the JSON is likely incomplete/truncated, not just invalid. Raise AI_MAX_TOKENS in .env, or use --split.`);
      }

      const text = rawText.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");

      let candidate;
      try {
        try {
          candidate = JSON.parse(text);
        } catch (syntaxErr) {
          let fixed = null;
          try {
            const { jsonrepair } = await import("jsonrepair");
            fixed = JSON.parse(jsonrepair(text));
          } catch (impErr) {
            if (impErr.code === "ERR_MODULE_NOT_FOUND") console.warn('  (run "npm i jsonrepair" to auto-fix broken JSON syntax locally)');
          }
          if (!fixed) throw syntaxErr;
          console.warn(`  Model JSON had a syntax error (${syntaxErr.message.slice(0, 60)}) - repaired locally; checking it against the schema.`);
          candidate = fixed;
        }
      } catch (e) {
        lastProblems = [`Output was not valid JSON: ${e.message}`];
        fs.writeFileSync(path.join(outDir, "normalized.raw.txt"), text);
        if (attempt < 2) await queueRetry(text, `Output was not valid JSON: ${e.message}`, `That was not valid JSON (${e.message}). Return ONLY the corrected JSON object.`);
        continue;
      }

      const san = sanitize(candidate, SCHEMA_OBJ);
      if (san.fixes.length) console.warn(`  Auto-corrected ${san.fixes.length} misplaced field(s) (e.g. ${san.fixes[0]}).`);
      if (san.dropped.length) {
        console.warn(`  Dropped ${san.dropped.length} field(s) the schema has no place for: ${san.dropped.slice(0, 3).join("; ")}`);
        candidate._uncertain = [...(candidate._uncertain || []), ...san.dropped.slice(0, 5)];
      }
      // An "unsupported" leaf that has an exported asset is really an image: the compiler would silently skip it otherwise.
      (function fixUnsupported(n) {
        if (!n || typeof n !== "object") return;
        if (n.type === "unsupported" && n.figmaNodeId) {
          const a = man.find((m) => m.nodeId === n.figmaNodeId);
          if (a) {
            console.warn(`  Converted "unsupported" element ${n.id} (${n.figmaNodeId}) to an image: its asset ${a.file} was already exported.`);
            n.type = "image";
            n.asset = { nodeId: a.nodeId, kind: a.type === "svg" ? "svg" : "image" };
            delete n.notes;
          }
        }
        for (const c of n.children || []) fixUnsupported(c);
      })(candidate);
      let { errors } = validateNormalized(candidate, man.length ? man : null);
      if (errors.length === 0 && hintTree) {
        let strp = structureProblems(hintTree, candidate);
        if (strp.length) {
          // Wrong nesting is fixable in code: keep the model's leaf elements, rebuild the grouping from the measured layout.
          const rebuilt = rebuildFromGeometry(candidate, hintTree);
          if (rebuilt && validateNormalized(rebuilt, man.length ? man : null).errors.length === 0 && structureProblems(hintTree, rebuilt).length === 0) {
            console.warn(`  Layout nesting did not match the measured layout (${strp.length} problem(s)); rebuilt the grouping from Figma geometry instead of retrying.`);
            candidate = rebuilt;
            strp = [];
          }
        }
        const sp = [...coverageProblems(hintTree, candidate), ...strp];
        if (sp.length) {
          if (attempt === 2) {
            console.warn("Accepting output with layout-nesting warnings (recorded in _uncertain):\n  - " + sp.join("\n  - "));
            candidate._uncertain = [...(candidate._uncertain || []), ...sp];
          } else {
            console.warn(`Attempt ${attempt}: ${sp.length} layout/coverage problem(s):\n  - ${sp.join("\n  - ")}`);
            errors = sp;
          }
        }
      }
      if (errors.length === 0) { parsed = candidate; break; }

      lastProblems = errors;
      console.warn(`Attempt ${attempt}: ${errors.length} schema error(s).`);
      fs.writeFileSync(path.join(outDir, "normalized.rejected.json"), JSON.stringify(candidate, null, 2));
      const errText = errors.slice(0, 40).map((e) => "- " + e).join("\n");
      if (attempt < 2) await queueRetry(text, errText, `Your JSON failed validation against the schema:\n${errText}\n\nReturn ONLY the corrected, complete JSON object.`);
    }

    if (!parsed) {
      console.error("Model output still failed validation after 2 attempts:");
      for (const e of lastProblems.slice(0, 20)) console.error("  -", e);
      console.error("Last rejected output saved next to normalized.json as normalized.rejected.json / normalized.raw.txt.");
      const fail = new Error(`Model output failed validation after 2 attempts: ${lastProblems.slice(0, 3).join("; ")}`);
      fail.validation = true;
      throw fail;
    }
    return parsed;
  }

  // ---- Split mode: break a too-big scope into parts that each fit the token budget ------------------------
  const unionBox = (nodes) => {
    const boxes = nodes.map((n) => n.absoluteBoundingBox).filter(Boolean);
    if (!boxes.length) return undefined;
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
  };
  const wrapNodes = (nodes) => ({ id: "scope", name: `${scopedRoot.name} (part)`, type: "FRAME", absoluteBoundingBox: unionBox(nodes), children: nodes });
  const promptTokens = async (nodes) => {
    const { content } = await buildPrompt(wrapNodes(nodes), { i: 0, n: 0 }, false);
    return estimateTokens([{ role: "user", content }]);
  };
  async function planParts(budget) {
    const fits = async (nodes) => (await promptTokens(nodes)) <= budget;
    const units = [];
    const descend = async (node) => {
      if (node.visible === false) return;
      if (await fits([node])) { units.push(node); return; }
      const kids = (node.children || []).filter((c) => c.visible !== false);
      if (!kids.length) { units.push(node); return; } // cannot be split further
      units.push({ ...node, children: [], _shell: true }); // the frame itself (its fills/border/radius) travels as a childless "shell"
      for (const c of kids) await descend(c);
    };
    for (const c of prunedRoot.children || []) await descend(c);
    const parts = [];
    let cur = [];
    for (const u of units) {
      if (cur.length && !(await fits([...cur, u]))) {
        // a frame shell must travel together with (at least the start of) its contents, never alone at the end of a part
        const carry = [];
        while (cur.length > 1 && cur[cur.length - 1]._shell) carry.unshift(cur.pop());
        parts.push(cur);
        cur = carry;
      }
      cur.push(u);
    }
    if (cur.length) parts.push(cur);
    return parts;
  }
  const dedupeIds = (doc) => {
    const seen = new Set();
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.type && n.id) {
        let id = n.id, k = 2;
        while (seen.has(id)) id = `${n.id}-${k++}`;
        n.id = id; seen.add(id);
      }
      for (const c of n.children || []) walk(c);
    })({ children: doc.children });
  };

  // Deterministic stand-in for a part the model could not answer: the text, images and frames in it, straight from the Figma data.
  // Sizes, typography, gaps and padding are filled in afterwards from the measured layout anyway.
  const fallbackDoc = (nodes) => {
    const hint = compactFigma(wrapNodes(nodes));
    const els = [];
    let k = 0;
    const idFor = (h, base) => `${slugify(h.name || base)}-${++k}`;
    (function walk(h) {
      if (!h || typeof h !== "object") return;
      if (h.g) { for (const c of h.children || []) walk(c); return; }
      if (h.type === "TEXT") { els.push({ type: "text", id: idFor(h, "text"), figmaNodeId: h.id, text: String(h.characters || h.name || "") }); return; }
      if (h.asset || h.imageExported) {
        const m = manifest.find((x) => x.nodeId === h.id);
        if (m) els.push({ type: "image", id: idFor(h, "image"), figmaNodeId: h.id, asset: { nodeId: h.id, kind: m.type === "svg" ? "svg" : "image" } });
        return;
      }
      if (!(h.children || []).length && ["FRAME", "GROUP", "INSTANCE", "COMPONENT"].includes(h.type)) {
        els.push({ type: h.layoutMode === "HORIZONTAL" ? "row" : "column", id: idFor(h, "frame"), figmaNodeId: h.id, children: [] });
      }
      for (const c of h.children || []) walk(c);
    })(hint);
    return { type: "page", children: [{ type: "section", id: "scope", figmaNodeId: "scope", children: els }] };
  };

  async function askInParts() {
    // Groq counts prompt + answer against one ~8k per-minute budget, so on Groq keep the prompt smaller to leave room for the answer.
    const budget = splitBudgetArg || Number(process.env.AI_CHUNK_TOKENS) || (CHAIN[0] === "groq" ? 4600 : 5500);
    const parts = await planParts(budget);
    const sizes = [];
    for (const p of parts) sizes.push(await promptTokens(p));
    console.log(`Split mode: ${parts.length} part(s), prompt sizes ~${sizes.map((n) => n.toLocaleString()).join(", ")} tokens (budget ${budget.toLocaleString()}).`);
    if (ESTIMATE) { reportEstimate(sizes, { label: `for ${scopeName || path.basename(outDir)} (${parts.length} parts)` }); process.exit(0); }
    const partsDir = path.join(outDir, "parts");
    fs.mkdirSync(partsDir, { recursive: true });
    const docs = [];
    // Saved parts are only reused if they were made for exactly the same node grouping (done.json records which node
    // set each finished part covers): otherwise the pieces would not fit together.
    const planKeys = [];
    for (const [i, p] of parts.entries()) {
      const prompt = await buildPrompt(wrapNodes(p), { i: i + 1, n: parts.length });
      planKeys.push(createHash("sha256").update(JSON.stringify(prompt.content)).digest("hex"));
    }
    const doneFile = path.join(partsDir, "done.json");
    let done = {};
    if (RESUME && fs.existsSync(doneFile)) { try { done = JSON.parse(fs.readFileSync(doneFile, "utf-8")); } catch {} }
    const saveDone = () => fs.writeFileSync(doneFile, JSON.stringify(done, null, 2));
    for (const k of Object.keys(done)) if (done[k] !== planKeys[Number(k)]) delete done[k];
    saveDone();
    for (const [i, nodes] of parts.entries()) {
      const file = path.join(partsDir, `part-${i + 1}.json`);
      if (RESUME && fs.existsSync(file) && done[i] === planKeys[i]) {
        console.log(`Part ${i + 1}/${parts.length}: reusing saved ${file}`);
        docs.push(JSON.parse(fs.readFileSync(file, "utf-8")));
        continue;
      }
      console.log(`\n=== Part ${i + 1}/${parts.length}: ${nodes.map((n) => n.name).join(", ").slice(0, 120)} ===`);
      // One part -> one doc. If the answer is cut off (small output cap) or fails validation and the part has several
      // nodes, ask for each half separately (a shorter answer fits) and join the halves; only a single node falls back to Figma data.
      const solve = async (ns, label, depth = 0) => {
        try {
          return await ask(wrapNodes(ns), { i: i + 1, n: parts.length });
        } catch (e) {
          if (!e.validation) throw e;
          if (ns.length > 1 && depth < 3) {
            console.warn(`  Part ${label} failed${lastTruncated ? " (answer cut off at max_tokens)" : " validation"} - splitting it into two smaller requests...`);
            const mid = Math.ceil(ns.length / 2);
            if (activeProvider === "groq") { console.log("Waiting 65s (Groq per-minute window)..."); await new Promise((r) => setTimeout(r, 65000)); }
            const a = await solve(ns.slice(0, mid), `${label}a`, depth + 1);
            if (activeProvider === "groq") { console.log("Waiting 65s (Groq per-minute window)..."); await new Promise((r) => setTimeout(r, 65000)); }
            const b = await solve(ns.slice(mid), `${label}b`, depth + 1);
            const s0 = a.children?.[0] || { type: "section", id: "scope", figmaNodeId: "scope", children: [] };
            return { ...a, children: [{ ...s0, children: [...(s0.children || []), ...(b.children?.[0]?.children || [])] }], _uncertain: [...(a._uncertain || []), ...(b._uncertain || [])] };
          }
          console.warn(`  Part ${label} could not be validated - building it from the Figma data alone (text, images and frames, without the model's styling for them).`);
          const fd = fallbackDoc(ns);
          fd._uncertain = [...(fd._uncertain || []), `part ${label}: model output failed validation; built from Figma data only, frame backgrounds/borders for it may be missing`];
          return fd;
        }
      };
      const d = await solve(nodes, String(i + 1));
      fs.writeFileSync(file, JSON.stringify(d, null, 2));
      done[i] = planKeys[i];
      saveDone();
      docs.push(d);
      if (i < parts.length - 1) {
        const wait = activeProvider === "groq" ? 65 : 3;
        console.log(`Waiting ${wait}s before the next part${activeProvider === "groq" ? " (Groq's per-minute token window)" : ""}...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    // stitch: all elements of all parts, flat, under one section; the nesting then comes from the measured layout
    const first = docs[0];
    const sec0 = first.children?.[0];
    if (!sec0) throw new Error("Split mode: the first part has no section element.");
    const { children: _c0, ...secRest } = sec0;
    for (const k of ["typography", "text", "level", "asset", "background", "border"]) delete secRest[k]; // the model sometimes puts the title's styling on the section itself
    // A part's answer should be ONE section, but a model sometimes adds extra top-level elements next to it. Fold those into the section's
    // element pool (the rebuild keeps one copy of each Figma node) instead of carrying them along as stray roots with duplicate ids.
    const allKids = docs.flatMap((d) => (d.children || []).flatMap((t, i) => (i === 0 ? t.children || [] : [t])));
    const merged = { ...first, children: [{ ...secRest, type: "section", figmaNodeId: "scope", children: allKids }] };
    const unc = docs.flatMap((d) => d._uncertain || []);
    if (unc.length) merged._uncertain = [...new Set(unc)];
    // Strict by-id coverage: repeated copy (e.g. identical Lorem Ipsum in every card) passes the text-equality check even when
    // that node was never emitted. Add any text/asset node whose id is absent, straight from the Figma data.
    {
      const present = new Set();
      (function w(n) { if (!n || typeof n !== "object") return; if (n.figmaNodeId) present.add(n.figmaNodeId); if (n.asset?.nodeId) present.add(n.asset.nodeId); for (const c of n.children || []) w(c); })({ children: merged.children });
      const fb = fallbackDoc(prunedRoot.children || []);
      const missing = (fb.children?.[0]?.children || []).filter((e) => (e.type === "text" || e.type === "image") && e.figmaNodeId && !present.has(e.figmaNodeId));
      if (missing.length) {
        merged.children[0].children.push(...missing);
        console.warn(`  Stitch check: ${missing.length} node(s) were missing from the model's parts (${missing.slice(0, 6).map((e) => e.figmaNodeId).join(", ")}${missing.length > 6 ? ", ..." : ""}) - added from the Figma data.`);
        merged._uncertain = [...new Set([...(merged._uncertain || []), `stitch: ${missing.length} node(s) added from Figma data because the model's parts did not include them`])];
      }
    }
    dedupeIds(merged);
    const reason = {};
    let rebuilt = rebuildFromGeometry(merged, measuredHint, { lenient: true, reason });
    if (!rebuilt) {
      // Last resort: the model's parts can't be matched to the layout. Every text and icon is still known from the Figma data, so build the
      // section from those (types/styling are re-measured from Figma anyway; only the model's heading-vs-text choices are lost).
      console.warn(`  Stitch: could not place the model's elements (${reason.why || "unknown reason"}) - building the section from the Figma data instead.`);
      const fb2 = fallbackDoc(prunedRoot.children || []);
      const leavesOnly = (fb2.children?.[0]?.children || []).filter((e) => e.type === "text" || e.type === "image");
      const m2 = { ...first, children: [{ ...secRest, type: "section", figmaNodeId: "scope", children: leavesOnly }, ...first.children.slice(1)] };
      m2._uncertain = [...new Set([...(merged._uncertain || []), `stitch: model parts could not be matched (${reason.why || "unknown"}); section built from Figma data only`])];
      dedupeIds(m2);
      rebuilt = rebuildFromGeometry(m2, measuredHint, { lenient: true, reason });
      if (!rebuilt) {
        // Never lose the whole section: keep every text/image in Figma order, flat. Post-processing still measures sizes, gaps and alignment.
        console.warn(`  Stitch: the Figma-only rebuild could not be nested either (${reason.why || "unknown"}) - keeping every text and image as a flat list in Figma order.`);
        rebuilt = m2;
      }
    }
    // Coverage guard: a stitched section that lost most of the Figma text (a nav bar answered only as a placeholder, for example) is worse than
    // the plain Figma-data build. Compare by node id or by copy.
    {
      const norm = (t) => String(t || "").replace(/<[^>]+>/g, "").replace(/[\s\u00a0]+/g, " ").trim().toLowerCase();
      const figmaTexts = [];
      (function w(n) { if (!n || typeof n !== "object" || n.visible === false) return; if (n.type === "TEXT" && norm(n.characters)) figmaTexts.push({ id: n.id, t: norm(n.characters) }); for (const c of n.children || []) w(c); })({ children: prunedRoot.children || [] });
      const ids = new Set(), copy = [];
      (function w(n) { if (!n || typeof n !== "object") return; if (n.figmaNodeId) ids.add(n.figmaNodeId); if (n.text) copy.push(norm(n.text)); for (const c of n.children || []) w(c); })(rebuilt);
      const covered = figmaTexts.filter((x) => ids.has(x.id) || copy.some((c) => c.includes(x.t))).length;
      if (figmaTexts.length >= 3 && covered < figmaTexts.length * 0.9) {
        console.warn(`  Stitch coverage: only ${covered}/${figmaTexts.length} Figma text nodes are in the stitched section - rebuilding it from the Figma data so nothing is lost.`);
        const fb4 = fallbackDoc(prunedRoot.children || []);
        const leaves4 = (fb4.children?.[0]?.children || []).filter((e) => e.type === "text" || e.type === "image");
        const m4 = { ...first, children: [{ ...secRest, type: "section", figmaNodeId: "scope", children: leaves4 }, ...first.children.slice(1)] };
        m4._uncertain = [...new Set([...(merged._uncertain || []), `stitch: only ${covered}/${figmaTexts.length} Figma texts were covered by the model parts; section rebuilt from Figma data`])];
        dedupeIds(m4);
        rebuilt = rebuildFromGeometry(m4, measuredHint, { lenient: true, reason: {} }) || m4;
      }
    }
    if (!rebuilt) throw new Error(`Split mode: could not stitch the parts together (${reason.why || "an element did not match the measured layout"}). Check the files in the parts/ folder, or re-run with a different --split=<tokens> budget.`);
    dedupeIds(rebuilt); // the rebuild can reuse an id the model gave two elements; make them unique before validating
    // A text element the model (or the stitch) left without its "text": take the copy from the Figma node with the same id, else drop the empty element
    // rather than failing the whole section.
    {
      const figmaText = new Map();
      (function w(n) { if (!n || typeof n !== "object") return; if (n.type === "TEXT" && typeof n.characters === "string" && n.characters.trim()) figmaText.set(n.id, n.characters); for (const c of n.children || []) w(c); })({ children: prunedRoot.children || [] });
      const TEXTY = new Set(["text", "text-basic", "heading", "button"]);
      let fixed = 0, dropped = 0;
      (function w(n) {
        if (!n || !Array.isArray(n.children)) return;
        n.children = n.children.filter((c) => {
          if (c && TEXTY.has(c.type) && !(typeof c.text === "string" && c.text.length)) {
            const t = c.figmaNodeId && figmaText.get(c.figmaNodeId);
            if (t) { c.text = t; fixed++; return true; }
            dropped++; return false;
          }
          return true;
        });
        for (const c of n.children) w(c);
      })(rebuilt);
      if (fixed || dropped) console.warn(`  Stitch: ${fixed} text element(s) had no copy - filled from Figma; ${dropped} empty one(s) dropped.`);
    }
    const errs = validateNormalized(rebuilt, manifest.length ? manifest : null).errors;
    if (errs.length) throw new Error("Split mode: stitched result failed validation:\n  - " + errs.slice(0, 10).join("\n  - "));
    console.log(`\nStitched ${parts.length} part(s) back into one section from the Figma geometry.`);
    return rebuilt;
  }

  let parsed;
  if (SPLIT) {
    parsed = await askInParts();
  } else {
    try {
      parsed = await ask(prunedRoot, null);
    } catch (e) {
      if (/larger than the Groq free tier/.test(String(e.message)) && CHAIN.includes("groq")) {
        console.warn("\nNo provider could take this section in one request - switching to automatic split mode (Groq, in parts).");
        CHAIN = ["groq"];
        parsed = await askInParts();
      } else throw e;
    }
  }

  // Deterministic pass: everything measurable/copyable comes from the Figma data, not the model.
  const isHero = /hero/i.test(scopeName || "") || process.argv.includes("--h1");
  const geoTree = compactMeasured(prunedRoot);
  const fin = finalize(parsed, geoTree, { gradients, isHero });
  const skipped = fin.filter((l) => l.includes("skipped"));
  console.log(`Post-processed from Figma data: ${fin.length - skipped.length} field group(s) set (text, typography, sizes, gaps, margins, padding, alignment, heading levels).`);
  for (const l of skipped) console.warn("  WARNING " + l);
  if (Array.isArray(parsed._uncertain)) {
    // The model's "not sure about spacing/size" notes are stale now that code measured those from Figma.
    const stale = (x) => !/dropped unknown field/i.test(x) && /padding|margin|gap|spacing|offCross|\bsizes?\b|width|height|alignment|not measured/i.test(x);
    const before = parsed._uncertain.length;
    parsed._uncertain = parsed._uncertain.filter((x) => !stale(String(x)));
    if (before !== parsed._uncertain.length) console.log(`Removed ${before - parsed._uncertain.length} model note(s) about spacing/size (now measured from Figma).`);
    if (!parsed._uncertain.length) delete parsed._uncertain;
  }
  const post = validateNormalized(parsed, manifest.length ? manifest : null).errors;
  if (post.length) {
    console.error("Post-processing produced schema errors (this is a script bug, please report):");
    for (const e of post.slice(0, 10)) console.error("  -", e);
    fs.writeFileSync(path.join(outDir, "normalized.rejected.json"), JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
  console.log(`Wrote ${outPath} (validated against schema/normalized-schema.json)`);

  if (parsed._uncertain?.length) {
    console.warn("Model flagged uncertain values:", parsed._uncertain);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
