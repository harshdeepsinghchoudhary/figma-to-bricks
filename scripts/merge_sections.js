/**
 * Merge several compiled section trees into one page tree, in the order given.
 *
 * Usage:
 *   node scripts/merge_sections.js output/<frame> hero who-we-are [more-section-names...]
 *
 * Writes output/<frame>/merged/bricks-tree.json. Asset urls are rewritten relative to that folder,
 * so you can inject it with:  node scripts/4_inject.js output/<frame>/merged <wp-page-id>
 */
import fs from "node:fs";
import path from "node:path";
import { bindMenuControls } from './menu-controls.js';
import { capTabletPadding } from './responsive-padding.js';
import { repairContentSpacing } from './content-spacing.js';
import { responsiveContent } from './responsive-content.js';
import { applyFooterMenus } from './footer-menus.js';
import { applyHeaderMenus } from './pipeline-menus.js';
import { sectionGap } from './section-gap.js';
import { pageSections } from './section-detect.js';
import { annotateMenuContext } from './source-menu-context.js';

const [frameDir, ...names] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!frameDir || !names.length) {
  console.error("Usage: node scripts/merge_sections.js output/<frame> <section> [<section> ...]");
  process.exit(1);
}
const outDir = path.join(frameDir, "merged");
fs.mkdirSync(outDir, { recursive: true });


// ---------------------------------------------------------------------------------------------
// Vertical spacing between sections, matched to Figma.
//   - band    = the section's visible extent (its top-level Figma node(s), e.g. a hero's background image)
//   - content = the actual content inside it
//   - padding inside a band is measured (content offset from the band edge)
//   - the empty gap between two bands is handed out like this:
//       * previous section has a background image (or is the nav bar)  -> the WHOLE gap goes to the next section's top padding
//       * next section has a background image                           -> the WHOLE gap goes to the previous section's bottom padding
//       * two plain sections                                            -> split in half (bottom of one, top of the other)
// ---------------------------------------------------------------------------------------------
function loadGeo(frameDir) {
  const fp = path.join(frameDir, "figma-node.json");
  if (!fs.existsSync(fp)) return null;
  const root = JSON.parse(fs.readFileSync(fp, "utf-8"));
  const box = new Map(), top = new Map();
  (function walk(n, topId) {
    const b = n.absoluteBoundingBox;
    if (n.id && b) { box.set(n.id, { x: b.x, y: b.y, w: b.width, h: b.height }); top.set(n.id, topId); }
    for (const c of n.children || []) walk(c, topId);
  })(root, null);
  for (const c of pageSections(root)) (function walk(n) { top.set(n.id, c.id); for (const k of n.children || []) walk(k); })(c);
  return { box, top, rootBox: box.get(root.id) || null };
}
const unionBox = (bs) => {
  if (!bs.length) return null;
  const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
  const x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};
function sectionBands(frameDir, names, trees) {
  const geo = loadGeo(frameDir);
  if (!geo) return null;
  const out = [];
  for (const [i, name] of names.entries()) {
    const np = path.join(frameDir, "sections", name, "normalized.json");
    if (!fs.existsSync(np)) { console.log(`  spacing: ${name} has no normalized.json - left out of the spacing`); continue; }
    const ids = new Set();
    (function walk(n) { if (!n || typeof n !== "object") return; if (n.figmaNodeId && geo.box.has(n.figmaNodeId)) ids.add(n.figmaNodeId); if (n.asset?.nodeId && geo.box.has(n.asset.nodeId)) ids.add(n.asset.nodeId); for (const id of n.figma?.paintSourceIds || []) if (geo.box.has(id)) ids.add(id); for (const c of n.children || []) walk(c); })(JSON.parse(fs.readFileSync(np, "utf-8")));
    // one section without Figma ids (an empty stub, say) must not switch the spacing off for the whole page
    if (!ids.size) { console.log(`  spacing: ${name} has no Figma geometry - kept its default padding, the others are still measured`); continue; }
    const tops = [...new Set([...ids].map((id) => geo.top.get(id)).filter(Boolean))];
    // Backdrop paint also defines the visible band's padding, without changing
    // normalization scope and invalidating an otherwise reusable content cache.
    const backdropFile = path.join(frameDir, 'backdrops.json');
    if (fs.existsSync(backdropFile)) for (const backdrop of JSON.parse(fs.readFileSync(backdropFile, 'utf8'))) {
      if (backdrop.sections?.length === 1 && backdrop.sections[0] === name && geo.box.has(backdrop.rectId) && !tops.includes(backdrop.rectId)) tops.push(backdrop.rectId);
    }
    const band = unionBox(tops.map((t) => geo.box.get(t)).filter(Boolean));
    const sec = trees[i].find((e) => e.name === "section");
    const hasBgImage = !!sec?.settings?._background?.image;
    let leafBoxes = [...ids].map((id) => geo.box.get(id)).filter((b) => !tops.includes(null));
    if (hasBgImage) leafBoxes = leafBoxes.filter((b) => !(b.w >= band.w * 0.95 && b.h >= band.h * 0.9)); // drop the background itself
    const content = unionBox(leafBoxes.filter((b) => !(b.w >= band.w * 0.95 && b.h >= band.h * 0.95 && leafBoxes.length > 1))) || unionBox(leafBoxes) || band;
    out.push({ name, band, content, bg: hasBgImage, sec });
  }
  return out;
}
function applyVerticalSpacing(frameDir, names, trees, pageColour) {
  const b = sectionBands(frameDir, names, trees);
  if (!b || !b.length) { console.log("Spacing: no Figma geometry for these sections - kept the compiler's default padding."); return; }
  const r = (v) => Math.max(0, Math.round(v));
  const pad = b.map((s) => ({ top: s.content.y - s.band.y, bottom: s.band.y + s.band.h - (s.content.y + s.content.h) }));
  const navFirst = (i) => i === 0 && b.length > 1 && b[0].band.h <= 160;
  // A section with its own fill (a different colour from the page) is a visible band, like one with a background image: the empty gap
  // between it and a plain section belongs to the plain one (a band keeps the padding its content was measured with).
  for (let i = 0; i + 1 < b.length; i++) {
    const A = b[i], B = b[i + 1];
    const G = Math.max(0, B.band.y - (A.band.y + A.band.h));
    if (G < 1) continue;
    const [bottom,top]=sectionGap(A.sec?.settings,B.sec?.settings,G,pageColour,navFirst(i));
    pad[i].bottom+=bottom;pad[i+1].top+=top;
  }
  const last = pad.length - 1;
  if (last > 0 && !b[last].bg && pad[last].bottom < 1) pad[last].bottom = pad[last].top; // nothing below it in the selection: mirror the top
  b.forEach((s, i) => {
    const st = s.sec?.settings;
    if (!st) return;
    st._padding = { ...(st._padding || {}) };
    delete st._padding["top"]; delete st._padding["bottom"];
    for (const k of Object.keys(st)) if (/^_padding:/.test(k)) { delete st[k].top; delete st[k].bottom; if (!Object.keys(st[k]).length) delete st[k]; }
    const tab = {}, mob = {};
    for (const side of ["top", "bottom"]) {
      const v = r(pad[i][side]);
      if (v <= 0) continue;
      st._padding[side] = String(v);
      const t = v >= 120 ? 120 : Math.round(v / 2);
      tab[side] = String(t); mob[side] = String(Math.min(t, 60));
    }
    st._padding = { top: st._padding.top, right: st._padding.right, bottom: st._padding.bottom, left: st._padding.left };
    for (const k of Object.keys(st._padding)) if (st._padding[k] === undefined) delete st._padding[k];
    if (Object.keys(tab).length) st["_padding:tablet_portrait"] = { ...(st["_padding:tablet_portrait"] || {}), ...tab };
    if (Object.keys(mob).length) st["_padding:mobile_landscape"] = { ...(st["_padding:mobile_landscape"] || {}), ...mob };
    console.log(`  spacing ${s.name}: top ${pad[i].top < 1 ? 0 : r(pad[i].top)}px, bottom ${r(pad[i].bottom)}px${s.bg ? " (background image)" : ""}`);
  });
}

const merged = [];
const seen = new Set();
const trees = [];
const sectionMap = [];
const sourceMap = {};
const sectionNames = fs.existsSync(path.join(frameDir, "sections.json")) ? JSON.parse(fs.readFileSync(path.join(frameDir, "sections.json"), "utf8")) : {};
for (const name of names) {
  const secDir = path.join(frameDir, "sections", name);
  const treePath = path.join(secDir, "bricks-tree.json");
  if (!fs.existsSync(treePath)) { console.error(`Missing ${treePath} - compile that section first.`); process.exit(1); }
  const tree = JSON.parse(fs.readFileSync(treePath, "utf-8"));
  trees.push(tree);
  const sourceFile = path.join(secDir, "bricks-source-map.json");
  if (fs.existsSync(sourceFile)) Object.assign(sourceMap, JSON.parse(fs.readFileSync(sourceFile, "utf8")));
  sectionMap.push({ name, figmaNodeId: Object.keys(sectionNames).find((id) => sectionNames[id] === name) || null, rootIds: tree.filter((e) => !e.parent || e.parent === "0").map((e) => e.id) });
  const fix = (u) => (typeof u === "string" && !/^(https?:|data:|\/\/)/i.test(u) ? path.relative(outDir, path.resolve(secDir, u)).split(path.sep).join("/") : u);
  for (const el of tree) {
    if (seen.has(el.id)) { console.error(`Duplicate Bricks element id ${el.id} in section ${name} - re-run its compile to get new ids.`); process.exit(1); }
    seen.add(el.id);
    const s = el.settings || {};
    if (s.image?.url) { s.image.url = fix(s.image.url); if (s.image.full) s.image.full = fix(s.image.full); }
    // section/container background image, and the ::before / ::after background images of decoration layers (_background::before ...)
    for (const k of Object.keys(s)) {
      if (!/^_background(:|$)/.test(k) || !s[k]?.image?.url) continue;
      s[k].image.url = fix(s[k].image.url);
      if (s[k].image.full) s[k].image.full = fix(s[k].image.full);
    }
    if (s.icon?.svg?.url) { s.icon.svg.url = fix(s.icon.svg.url); if (s.icon.svg.full) s.icon.svg.full = fix(s.icon.svg.full); }
    merged.push(el);
  }
  console.log(`+ ${name}: ${tree.length} element(s)`);
}

// Page background. The Figma root frame's fill belongs to no section, so sections came out transparent
// (white text on Bricks' default white page). Sections with no background of their own get the page colour.
function applyPageBackground() {
  const fp = path.join(frameDir, "figma-node.json");
  if (!fs.existsSync(fp)) return;
  const root = JSON.parse(fs.readFileSync(fp, "utf-8"));
  const fill = (root.fills || []).find((f) => f.visible !== false && f.type === "SOLID");
  if (!fill) { console.log("  page background: root frame has no solid fill - left sections as they are"); return; }
  const c = fill.color, a = (fill.opacity ?? 1) * (c.a ?? 1);
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  const raw = ("#" + hex(c.r) + hex(c.g) + hex(c.b) + (a < 1 ? hex(a) : "")).toUpperCase();
  let n = 0;
  for (const el of merged) {
    if (el.name !== "section") continue;
    const bg = el.settings?._background;
    if (bg?.color || bg?.image || el.settings?._gradient) continue;
    el.settings = el.settings || {};
    el.settings._background = { ...(bg || {}), color: { raw } };
    n++;
  }
  console.log("  page background " + raw + " applied to " + n + " section(s) that had no background of their own");
  return raw;
}
// Backdrop rectangles (run-sections.js): their solid colour is the background of the sections they sit behind.
function applyBackdrops() {
  const fp = path.join(frameDir, "backdrops.json");
  if (!fs.existsSync(fp)) return;
  let n = 0;
  for (const b of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    for (const name of b.sections) {
      const entry = sectionMap.find((m) => m.name === name);
      for (const el of merged) {
        if (el.name !== "section" || !entry?.rootIds.includes(el.id)) continue;
        const bg = el.settings?._background;
        if (bg?.color || bg?.image || el.settings?._gradient) continue;
        el.settings = el.settings || {};
        el.settings._background = { ...(bg || {}), color: { raw: b.color } };
        n++;
      }
    }
  }
  if (n) console.log("  backdrop colours applied to " + n + " section(s)");
}
applyBackdrops();
const pageColour=!process.argv.includes("--no-page-bg") ? applyPageBackground() : undefined;
if (!process.argv.includes("--no-spacing")) applyVerticalSpacing(frameDir, names, trees,pageColour);
// Keep the source-backed tree for menu discovery before widgets replace text.
const autoControls=annotateMenuContext(sourceMap,JSON.parse(fs.readFileSync(path.join(frameDir,'figma-node.json'),'utf8')));
const controlsPath=path.join(frameDir,'menu-controls.json');
if(!fs.existsSync(controlsPath)&&autoControls.length)fs.writeFileSync(controlsPath,JSON.stringify(autoControls,null,2));
fs.writeFileSync(path.join(outDir, 'menu-source.json'), JSON.stringify({tree:merged,sourceMap}));
const menuBindings = path.join(frameDir, 'menu-controls.json');
if (fs.existsSync(menuBindings)) bindMenuControls(merged, sourceMap, JSON.parse(fs.readFileSync(menuBindings,'utf8')));
const wordpressBindings=path.join(frameDir,'wordpress-menus.json');
if(fs.existsSync(wordpressBindings))applyHeaderMenus(merged,sourceMap,JSON.parse(fs.readFileSync(wordpressBindings,'utf8')));
const spacingSource=path.join(frameDir,'figma-node.json');
for(const line of repairContentSpacing(merged,sourceMap,fs.existsSync(spacingSource)?JSON.parse(fs.readFileSync(spacingSource,'utf8')):null)) console.log('  spacing repair: '+line);
capTabletPadding(merged);
const footerBindings=path.join(frameDir,'footer-menus.json');
if(fs.existsSync(footerBindings))applyFooterMenus(merged,sourceMap,JSON.parse(fs.readFileSync(footerBindings,'utf8')));
responsiveContent(merged,sourceMap,JSON.parse(fs.readFileSync(path.join(frameDir,'figma-node.json'),'utf8')));
fs.writeFileSync(path.join(outDir, "bricks-tree.json"), JSON.stringify(merged, null, 2));
fs.writeFileSync(path.join(outDir, "section-map.json"), JSON.stringify(sectionMap, null, 2));
fs.writeFileSync(path.join(outDir, "bricks-source-map.json"), JSON.stringify(sourceMap, null, 2));
console.log(`Wrote ${path.join(outDir, "bricks-tree.json")} (${merged.length} element(s), top-level sections in order: ${names.join(", ")})`);
