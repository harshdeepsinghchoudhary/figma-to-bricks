/**
 * Structure pass (stage 3, deterministic, no LLM). Runs on the validated normalized tree BEFORE responsive-pass.js.
 * Goal: the smallest tree that still renders the same, plus design info the model step loses. Existing normalized.json
 * files benefit without a model re-run.
 *
 * Rules (each one logs a "structure:" line so every change is traceable):
 *   1. background recovery  - a section with no fill of its own gets the full-width Figma rectangle behind its content
 *                             (the model never sees it because the section is a top-level scope node with no parent).
 *   2. wrapper removal      - a row/column with ONE child and no look of its own (no fill, border, size, padding, margin,
 *                             justify, differing alignment) is replaced by that child.
 *   3. card titles          - the first bold text of a card (column with fill/border) that also holds a paragraph becomes
 *                             an h3 heading.
 * Skip the whole pass with --no-structure.
 */
import { findPanels } from "./decoration-detect.js";
import { applyStructureRules, buildFigmaIndex } from "./structure-rules.js";
const isNum = (v) => typeof v === "number" && isFinite(v);
const LEAF = new Set(["heading", "text", "text-basic", "button", "image", "icon", "unsupported", "spacer"]);
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

export function structurePass(input, { figmaRoot = null, manifest = [], enable = {} } = {}) {
  // general structure rules first (hoist, dividers, rebuild, decoration, wrappers, grids, spanning, roles, sanity): see structure-rules.js
  const pre = [];
  let base = input;
  const ruleStats = {};
  if (figmaRoot && enable.rules !== false) {
    const idx = buildFigmaIndex(figmaRoot, new Set(manifest.map((a) => a.nodeId)));
    // shapes the decoration step places later as pseudo-element layers of a card - they are not "missing pictures"
    const claimed = new Set();
    const mark = (id) => { claimed.add(id); for (const c of idx[id]?.children || []) mark(c); };
    try { for (const panel of findPanels(figmaRoot)) for (const l of panel.layers) mark(l.id); } catch { /* no panels */ }
    const r = applyStructureRules(input, { figma: idx, rootBox: idx[figmaRoot.id]?.box || null, manifest, enable, claimed });
    base = r.doc; pre.push(...r.report); Object.assign(ruleStats, r.stats);
  }
  const doc = JSON.parse(JSON.stringify(base));
  const report = [...pre];
  const log = (m) => report.push(m);
  const stats = { background: 0, unwrapped: 0, headings: 0, cards: 0, layers: 0, scopeW: 0 };

  // ---------- 1. background recovery ----------
  if (figmaRoot) {
    const nodes = {};
    (function walk(n) { if (n?.id) nodes[n.id] = n; for (const c of n?.children || []) walk(c); })(figmaRoot);
    const rootBox = figmaRoot.absoluteBoundingBox;
    const bboxOf = (ids) => {
      const bs = ids.map((i) => nodes[i]?.absoluteBoundingBox).filter(Boolean);
      if (!bs.length) return null;
      const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
      const x2 = Math.max(...bs.map((b) => b.x + b.width)), y2 = Math.max(...bs.map((b) => b.y + b.height));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };
    const idsIn = (n, out = []) => { if (n.figmaNodeId && nodes[n.figmaNodeId]) out.push(n.figmaNodeId); if (n.asset?.nodeId && nodes[n.asset.nodeId]) out.push(n.asset.nodeId); for (const c of n.children || []) idsIn(c, out); return out; };
    const rects = Object.values(nodes).filter((n) => (n.type === "RECTANGLE" || n.type === "FRAME") && n.absoluteBoundingBox && n.visible !== false
      && (n.fills || []).some((f) => f.type === "SOLID" && f.visible !== false) && !(n.fills || []).some((f) => f.type === "IMAGE" && f.visible !== false)
      && hex((n.fills.find((f) => f.type === "SOLID" && f.visible !== false)).color) !== "#D9D9D9" // Figma's default placeholder grey sits behind a photo; it is not the design's background
      && !(n.children || []).length
      && n.absoluteBoundingBox.width >= (rootBox?.width || 1440) * 0.95);
    for (const sec of (doc.children || []).filter((c) => c.type === "section")) {
      if (sec.background || sec.asset) continue;
      const box = bboxOf(idsIn(sec));
      if (!box) continue;
      const cy = box.y + box.h / 2;
      const cands = rects.filter((r) => { const b = r.absoluteBoundingBox; return cy >= b.y && cy <= b.y + b.height && b.y <= box.y + 2 && b.y + b.height >= box.y + box.h - 2 && b.height <= box.h * 1.6 + 120; })
        .sort((a, b) => a.absoluteBoundingBox.width * a.absoluteBoundingBox.height - b.absoluteBoundingBox.width * b.absoluteBoundingBox.height);
      const r = cands[0];
      if (!r) continue;
      const fill = r.fills.find((f) => f.type === "SOLID" && f.visible !== false);
      const color = hex(fill.color);
      sec.background = { color };
      stats.background++;
      log(`section ${sec.id}: background ${color} from full-width Figma rectangle ${r.id}`);
    }
  }

  // ---------- 5. cards, decoration layers, scope width ----------
  if (figmaRoot) {
    const nodes = {};
    (function walk(n) { if (n?.id) nodes[n.id] = n; for (const c of n?.children || []) walk(c); })(figmaRoot);
    const rootW = figmaRoot.absoluteBoundingBox?.width || 1440;
    const panels = findPanels(figmaRoot);
    const ids = (n, out = []) => { if (n.figmaNodeId && nodes[n.figmaNodeId]) out.push(n.figmaNodeId); if (n.asset?.nodeId && nodes[n.asset.nodeId]) out.push(n.asset.nodeId); for (const c of n.children || []) ids(c, out); return out; };
    for (const sec of (doc.children || []).filter((c) => c.type === "section")) {
      const bs = ids(sec).map((i) => nodes[i]?.absoluteBoundingBox).filter(Boolean);
      if (!bs.length) continue;
      const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y)), x2 = Math.max(...bs.map((b) => b.x + b.width)), y2 = Math.max(...bs.map((b) => b.y + b.height));
      // a section whose whole scope is narrower than the site container sets the container's max-width itself
      if (x2 - x1 >= 840 && x2 - x1 < 1199) { sec._scopeW = Math.round(x2 - x1); stats.scopeW++; log(`section ${sec.id}: scope is ${sec._scopeW}px wide -> container max-width ${sec._scopeW}px`); }
      // the panel behind this section's content (smallest one that contains it)
      const hit = panels.filter((p) => p.box.x - 2 <= x1 && p.box.y - 2 <= y1 && p.box.x + p.box.width + 2 >= x2 && p.box.y + p.box.height + 2 >= y2 && !(x1 <= p.box.x && x2 >= p.box.x + p.box.width && y1 <= p.box.y && y2 >= p.box.y + p.box.height))
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
      if (!hit) continue;
      const full = hit.box.width >= rootW * 0.95;
      const layers = hit.layers.map((l, i) => {
        const same = Math.abs(l.box.width - hit.box.width) <= 4 && Math.abs(l.box.height - hit.box.height) <= 4;
        return { asset: { nodeId: l.id }, placement: i === 0 ? "before" : "after", ...(same ? { inset: true } : { box: { left: Math.round(((l.box.x - hit.box.x) / hit.box.width) * 1000) / 10, top: Math.round(l.box.y - hit.box.y), width: Math.round(l.box.width), height: Math.round(l.box.height) } }) };
      });
      if (hit.dropped) log(`panel ${hit.id}: ${hit.dropped} more decoration layer(s) beyond ${layers.length} were not placed (a pseudo-element pair holds two)`);
      if (full) {
        if (layers.length) { sec._pseudo = layers; stats.layers += layers.length; log(`section ${sec.id}: ${layers.length} decoration layer(s) from panel ${hit.id} -> ::before/::after backgrounds on the section`); }
      } else {
        sec._card = { color: hit.bg.color, radius: hit.bg.radius, width: Math.round(hit.box.width), top: Math.max(0, Math.round(y1 - hit.box.y)), bottom: Math.max(0, Math.round(hit.box.y + hit.box.height - y2)), layers };
        stats.cards++; stats.layers += layers.length;
        log(`section ${sec.id}: card ${hit.bg.color} radius ${hit.bg.radius}, ${sec._card.width}px wide, padding ${sec._card.top}/${sec._card.bottom} (panel ${hit.id}); ${layers.length} decoration layer(s) -> ::before/::after`);
      }
    }
  }

  // ---------- 4. missing-text check (report only: inserting guessed nodes is riskier than flagging them) ----------
  if (figmaRoot) {
    const norm = (t) => String(t || "").replace(/<[^>]+>/g, "").replace(/[\s\u00a0]+/g, " ").trim().toLowerCase();
    const have = [];
    (function w(n) { if (n.text) have.push(norm(n.text)); for (const c of n.children || []) w(c); })(doc);
    const all = []; (function w(n) { if (n?.id) all.push(n); for (const c of n?.children || []) w(c); })(figmaRoot);
    const ids = new Set(); (function w(n) { if (n.figmaNodeId) ids.add(n.figmaNodeId); if (n.asset?.nodeId) ids.add(n.asset.nodeId); for (const c of n.children || []) w(c); })(doc);
    const bs = all.filter((n) => ids.has(n.id) && n.absoluteBoundingBox).map((n) => n.absoluteBoundingBox);
    if (bs.length) {
      const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y)), x2 = Math.max(...bs.map((b) => b.x + b.width)), y2 = Math.max(...bs.map((b) => b.y + b.height));
      for (const t of all) {
        if (t.type !== "TEXT" || t.visible === false || !norm(t.characters) || !t.absoluteBoundingBox) continue;
        const b = t.absoluteBoundingBox, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        if (cx < x1 || cx > x2 || cy < y1 || cy > y2) continue;
        const c = norm(t.characters);
        if (have.some((h) => h.includes(c) || (c.length > 20 && c.includes(h) && h.length > 20))) continue;
        log(`MISSING TEXT "${t.characters.slice(0, 40)}" (figma ${t.id}) is not in the normalized tree - check this section`);
      }
    }
  }

  // ---------- 2 + 3 ----------
  const plain = (n) => n.layout && !n.background && !n._bgImage && !n._relative && !n._fullBleed && !n.border && !n.size && !(n.notes || []).length
    && !n.layout.padding && !n.layout.margin && !n.layout.justify;
  function visit(n, parent) {
    n.children = (n.children || []).map((c) => visit(c, n));
    if ((n.type === "row" || n.type === "column") && n.children.length === 1 && parent && parent.type !== "page" && plain(n)) {
      const kid = n.children[0];
      const sameAlign = !n.layout.align || n.layout.align === "start" || n.layout.align === "stretch" || n.layout.align === parent.layout?.align;
      // a one-child wrapper's own gap is irrelevant; a child that sets its own size/margin keeps working inside the parent
      if (kid.type !== "section" && sameAlign && !(kid.type === "unsupported")) {
        stats.unwrapped++;
        log(`removed single-child wrapper ${n.id} around ${kid.id}`);
        return kid;
      }
    }
    // card title -> h3: a column holding exactly [bold text, lighter text...] and nothing else is a title + description
    if (n.type === "column" && n.children.length >= 2 && n.children.every((c) => c.type === "text" || c.type === "text-basic")) {
      const [first, ...rest] = n.children;
      const fw = first.typography?.fontWeight || 0, fs = first.typography?.fontSize || 0;
      if (first.type === "text" && fw >= 600 && fs >= 16 && rest.every((t) => (t.typography?.fontWeight || 400) < fw && (t.typography?.fontSize || 0) <= fs)
        && !String(first.text).includes("\n") && String(first.text).length <= 80) {
        first.type = "heading"; first.level = 3;
        stats.headings++;
        log(`card title "${String(first.text).slice(0, 30)}" (${first.id}) -> h3`);
      }
    }
    return n;
  }
  doc.children = (doc.children || []).map((c) => visit(c, doc));
  log(`summary: background ${stats.background}, unwrapped ${stats.unwrapped}, headings ${stats.headings}, cards ${stats.cards}, layers ${stats.layers}, scope widths ${stats.scopeW}`);
  return { doc, report, stats: { ...stats, ...ruleStats } };
}