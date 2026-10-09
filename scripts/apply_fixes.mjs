#!/usr/bin/env node
/**
 * Applies three compiler fixes to your existing scripts. Run once from the project root:
 *
 *   node scripts/apply_fixes.mjs            (or wherever you saved this file)
 *   node scripts/apply_fixes.mjs --check    (report only, change nothing)
 *
 * Safe by design:
 *  - every edit matches an exact piece of the CURRENT file; if your file has changed and the piece
 *    isn't found exactly once, that edit is skipped and reported (nothing is guessed)
 *  - a .bak copy of each file is saved the first time it is changed
 *  - running it twice does nothing the second time
 *
 * Fixes:
 *  1. bricks-schema.js      borders now get  style: "solid"  (Bricks ignores width/colour without it)
 *  2. merge_sections.js     Figma's root-frame fill becomes the background of sections that have none
 *  3. normalize-postprocess.js  rows whose items sit at opposite ends use space-between instead of a
 *                               huge fixed gap (e.g. 294px / 428px), and keep a width so it can work
 *  4. 2_normalize.js        a card drawn as a GROUP of shapes (rectangle + mask + vector) is recognised as the
 *                           parent's background, so the text on it stays inside the card
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CHECK_ONLY = process.argv.includes("--check");
const scriptsDir = fs.existsSync("scripts/bricks-schema.js") ? "scripts" : fs.existsSync("bricks-schema.js") ? "." : null;
if (!scriptsDir) {
  console.error("Run this from the project root (the folder that contains scripts/).");
  process.exit(1);
}

const edits = [
  {
    file: "bricks-schema.js",
    name: "border style solid",
    done: 'style: "solid", color: { raw: src.border.color }',
    old: "    out._border = { ...(out._border || {}), color: { raw: src.border.color }, width: { top: w, right: w, bottom: w, left: w } };",
    neu: '    out._border = { ...(out._border || {}), style: "solid", color: { raw: src.border.color }, width: { top: w, right: w, bottom: w, left: w } };',
  },
  {
    file: "merge_sections.js",
    name: "page background from Figma root frame",
    done: "function applyPageBackground",
    old: 'if (!process.argv.includes("--no-spacing")) applyVerticalSpacing(frameDir, names, trees);',
    neu: `if (!process.argv.includes("--no-spacing")) applyVerticalSpacing(frameDir, names, trees);

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
}
if (!process.argv.includes("--no-page-bg")) applyPageBackground();`,
  },
  {
    file: "normalize-postprocess.js",
    name: "space-between instead of huge gaps",
    done: "const figSB =",
    old: `    delete n.layout.gap; delete n.layout.rowGap; delete n.layout.columnGap;
    if (gaps.length && gaps.every((g) => Math.abs(g - gaps[0]) <= 1) && gaps[0] > 0.5) {`,
    neu: `    delete n.layout.gap; delete n.layout.rowGap; delete n.layout.columnGap;
    // Items pushed to opposite ends of a row are "space-between", not a fixed px gap (a 294px gap overflows on small screens).
    const figSB = dir === "row" && flow.length > 1 && geoOf(n)?.layoutMode === "HORIZONTAL" && geoOf(n)?.primaryAxisAlignItems === "SPACE_BETWEEN";
    const wideEven = dir === "row" && flow.length > 1 && gaps.length > 0 && gaps.every((g) => Math.abs(g - gaps[0]) <= 1) && gaps[0] >= 120 && gaps[0] > 2 * Math.min(...rects.map((r) => r[mainLen]));
    if (figSB || wideEven) {
      n.layout.justify = "space-between";
      set(\`\${n.id}: space-between instead of a \${r2(Math.max(...gaps))}px gap (\${figSB ? "Figma auto-layout" : "wide even gap measured from geometry"})\`);
    } else if (gaps.length && gaps.every((g) => Math.abs(g - gaps[0]) <= 1) && gaps[0] > 0.5) {`,
  },
  {
    file: "normalize-postprocess.js",
    name: "keep width on space-between rows",
    done: 'n.layout?.justify === "space-between" && (n.layout?.direction',
    old: "      if (parentIsRow && r) n.size = { ...(n.size || {}), width: r2(r.w) };",
    neu: '      const sbRow = n.layout?.justify === "space-between" && (n.layout?.direction === "row" || n.type === "row");\n      if ((parentIsRow || sbRow) && r) n.size = { ...(n.size || {}), width: r2(r.w) };',
  },
  {
    file: "2_normalize.js",
    name: "card drawn as a group of shapes counts as the background",
    done: "collapseArtGroups",
    old: [
      "      const bgItems = items.filter(isBg);",
      "      bgItems.forEach((it) => { it.o.isParentBackground = true; });",
    ].join("\n"),
    neu: [
      "      // collapseArtGroups: a card drawn as a GROUP of shapes (rectangle + mask + decorative vector) is not a bare RECTANGLE, so it was never",
      "      // recognised as the background and the text on top of it landed in a separate div. In the measured tree only (prompts are untouched, so",
      "      // saved --resume parts stay valid) a shapes-only group that covers the parent is replaced by its full-size rectangle, which the code below",
      "      // flags as the parent's background. Decorative shapes (masked vectors) stay out of the layout flow.",
      "      if (relaxBg && b && items.length >= 2) {",
      "        const hasText = (x) => x.type === \"TEXT\" || (x.children || []).some(hasText);",
      "        const hasImg = (x) => hasImageFill(x) || (x.children || []).some(hasImg);",
      "        const covers = (bx) => bx && bx.width >= b.width * 0.98 && bx.height >= b.height * 0.98;",
      "        const bgRectIn = (x) => {",
      "          if (x.visible === false) return null;",
      "          if (x.type === \"RECTANGLE\" && !x.children?.length && covers(x.absoluteBoundingBox) && (x.fills || []).some((f) => f.visible !== false && (f.type === \"SOLID\" || String(f.type).startsWith(\"GRADIENT\")))) return x;",
      "          for (const ch of x.children || []) { const r = bgRectIn(ch); if (r) return r; }",
      "          return null;",
      "        };",
      "        for (const it of items) {",
      "          if (it.c.type !== \"GROUP\" || (it.c.layoutMode && it.c.layoutMode !== \"NONE\") || !covers(it.b) || !it.c.children?.length || hasText(it.c) || hasImg(it.c)) continue;",
      "          const rect = bgRectIn(it.c);",
      "          const at = rect ? out.children.indexOf(it.o) : -1;",
      "          if (at < 0) continue;",
      "          console.log(\"  card background: group \\\"\" + it.c.name + \"\\\" collapsed to its rectangle (decorative shapes left out of the flow)\");",
      "          out.children[at] = compactFigma(rect);",
      "          it.o = out.children[at]; it.c = rect; it.b = rect.absoluteBoundingBox;",
      "        }",
      "      }",
      "      const bgItems = items.filter(isBg);",
      "      bgItems.forEach((it) => { it.o.isParentBackground = true; });",
    ].join("\n"),
  },
];

let applied = 0, skipped = 0, already = 0;
const touched = new Set();
const byFile = new Map();
for (const e of edits) byFile.set(e.file, [...(byFile.get(e.file) || []), e]);

for (const [file, list] of byFile) {
  const fp = path.join(scriptsDir, file);
  if (!fs.existsSync(fp)) { console.log(`SKIP  ${file}: file not found`); skipped += list.length; continue; }
  let src = fs.readFileSync(fp, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const fit = (s) => s.replace(/\r?\n/g, eol);
  let changed = false;
  for (const e of list) {
    if (src.includes(fit(e.done))) { console.log(`OK    ${file}: "${e.name}" already applied`); already++; continue; }
    const old = fit(e.old);
    const count = src.split(old).length - 1;
    if (count !== 1) {
      console.log(`SKIP  ${file}: "${e.name}" - expected text found ${count} time(s), not exactly once. Your file differs from the one I checked; send me that part of the file.`);
      skipped++;
      continue;
    }
    src = src.replace(old, () => fit(e.neu));
    changed = true;
    applied++;
    console.log(`${CHECK_ONLY ? "WOULD" : "DONE "} ${file}: "${e.name}"`);
  }
  if (changed && !CHECK_ONLY) {
    const bak = fp + ".bak";
    if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
    fs.writeFileSync(fp, src);
    touched.add(fp);
  }
}

for (const fp of touched) {
  try { execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" }); }
  catch (err) {
    console.error(`\nSYNTAX ERROR in ${fp} after patching - restoring the backup.\n${String(err.stderr || err.message).slice(0, 400)}`);
    fs.copyFileSync(fp + ".bak", fp);
    process.exit(1);
  }
}
console.log(`\n${CHECK_ONLY ? "Check only: " : ""}${applied} edit(s) ${CHECK_ONLY ? "would be applied" : "applied"}, ${already} already in place, ${skipped} skipped.`);
if (applied && !CHECK_ONLY) console.log("Backups: <file>.bak next to each changed script. Re-run stage 2 (normalize) for sections whose layout you want regenerated, then stage 3 and merge.");
