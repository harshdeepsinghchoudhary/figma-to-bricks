/**
 * Build every top-level section of a Figma page, then merge them into one Bricks template.
 *
 * Usage:
 *   node scripts/run-sections.js output/<frame>                 run every section that is not done yet, then merge
 *   node scripts/run-sections.js output/<frame> --dry-run       only print the plan (section -> Figma node, done / to do)
 *   node scripts/run-sections.js output/<frame> --only=hero,section-07   just these sections
 *   node scripts/run-sections.js output/<frame> --force         redo the model step even for finished sections
 *   node scripts/run-sections.js output/<frame> --split=4600    token budget per model request (default 4600)
 *   node scripts/run-sections.js output/<frame> --no-merge      skip the merge + template step
 *   node scripts/run-sections.js output/<frame> --skip=section-02   leave a section out on purpose (a broken or duplicate frame)
 *   node scripts/run-sections.js output/<frame> --keep-duplicates   do not auto-skip duplicate frames (see below)
 *
 * Duplicate frames: two top-level nodes in the same place with (nearly) the same size are one section drawn twice. The one that is already
 * built is kept; if neither is, the later one on the page is skipped. Skipped sections are listed and never count as a failure.
 *
 * What it does, per top-level child of the page (sorted top to bottom):
 *   2_normalize.js <frame> --nodes=<id> --name=<name> --split=N --resume     (the model step; --resume reuses saved parts, so a
 *                                                                              run that was interrupted continues where it stopped)
 *   3_compile_bricks.js <frame>/sections/<name>                              (deterministic)
 * and at the end:
 *   merge_sections.js <frame> <all compiled sections in page order>
 *   wrap-template.js  <frame>/merged "<template name>"
 *
 * Section names live in <frame>/sections.json ({ "<figma node id>": "<name>" }). It is created on the first run, seeded with any section
 * folders that already exist, and the rest are called section-NN (NN = position on the page). Rename entries there before a run if you
 * want nicer names; a finished section is matched by node id, so renaming one that is already built needs --force (or move its folder).
 *
 * A section that fails does not stop the run: the others still build, the failures are listed at the end and the exit code is 1.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decorationOwner, pageSections } from "./section-detect.js";

const args = process.argv.slice(2);
const frameDir = args.find((a) => !a.startsWith("--"));
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
if (!frameDir) {
  console.error("Usage: node scripts/run-sections.js output/<frame> [--dry-run] [--only=a,b] [--force] [--split=4600] [--no-merge]");
  process.exit(1);
}

const figmaPath = path.join(frameDir, "figma-node.json");
if (!fs.existsSync(figmaPath)) { console.error(`Missing ${figmaPath} - run stage 1 first.`); process.exit(1); }
const root = JSON.parse(fs.readFileSync(figmaPath, "utf-8"));
const top = [...pageSections(root)]
  .filter((n) => n.visible !== false && n.absoluteBoundingBox)
  .sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y || a.absoluteBoundingBox.x - b.absoluteBoundingBox.x);
if (!top.length) { console.error("The frame has no top-level children."); process.exit(1); }

// ---- names: sections.json, seeded from section folders that already exist ----
const secRoot = path.join(frameDir, "sections");
const namesPath = path.join(frameDir, "sections.json");
let names = {};
if (fs.existsSync(namesPath)) names = JSON.parse(fs.readFileSync(namesPath, "utf-8"));

// which Figma node did an existing section folder come from? (first node id in its saved prompt)
function nodeOfFolder(dir) {
  const p = path.join(dir, "prompt-figma.json");
  if (!fs.existsSync(p)) return null;
  const find = (x) => {
    if (Array.isArray(x)) { for (const v of x) { const r = find(v); if (r) return r; } return null; }
    if (x && typeof x === "object") {
      for (const k of ["id", "i"]) if (typeof x[k] === "string" && /^\d+:\d+$/.test(x[k])) return x[k];
      for (const v of Object.values(x)) { const r = find(v); if (r) return r; }
    }
    return null;
  };
  try { return find(JSON.parse(fs.readFileSync(p, "utf-8"))); } catch { return null; }
}
const ids = new Set(top.map((n) => n.id));
if (fs.existsSync(secRoot)) {
  for (const d of fs.readdirSync(secRoot)) {
    const full = path.join(secRoot, d);
    if (!fs.statSync(full).isDirectory()) continue;
    const id = nodeOfFolder(full);
    if (id && ids.has(id) && !names[id]) names[id] = d;
  }
}
const used = new Set(Object.values(names));
for (const name of used) if (typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Unsafe section folder name: ${name}`);
const pad = String(top.length).length < 2 ? 2 : String(top.length).length;
const sections = top.map((n, i) => {
  if (!names[n.id]) {
    let nm = `section-${String(i + 1).padStart(pad, "0")}`;
    while (used.has(nm)) nm += "x";
    names[n.id] = nm; used.add(nm);
  }
  return { id: n.id, name: names[n.id], figmaName: n.name, box: n.absoluteBoundingBox, index: i + 1 };
});
fs.writeFileSync(namesPath, JSON.stringify(names, null, 2) + "\n");

const only = opt("only") ? new Set(opt("only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (only) for (const o of only) if (!sections.some((s) => s.name === o || s.id === o)) { console.error(`--only: no section called "${o}". Known: ${sections.map((s) => s.name).join(", ")}`); process.exit(1); }
const skipSet = new Set((opt("skip", "") || "").split(",").map((x) => x.trim()).filter(Boolean));
const iou = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.width * a.height + b.width * b.height - w * h);
};
const skipReason = {};
for (const s of sections) if (skipSet.has(s.name) || skipSet.has(s.id)) skipReason[s.name] = "left out (--skip)";
for (const s of sections) {
  if (skipReason[s.name] || only?.has(s.name) || only?.has(s.id)) continue;
  const owner = decorationOwner(top.find((n) => n.id === s.id), top);
  if (owner) skipReason[s.name] = `decorative shape inside ${names[owner.id]} (not a standalone section)`;
}
// What a top-level frame says: its copy and whether it carries pictures. Two frames in the same place are the SAME section drawn twice
// only when they say the same thing. A picture-only banner and a frame holding its headline and button are two layers of ONE section.
const copyOf = (n) => { const t = new Set(); let pics = 0; (function w(x) { if (x.visible === false) return; if (x.type === "TEXT" && x.characters?.trim()) t.add(x.characters.trim().toLowerCase()); if ((x.fills || []).some((f) => f.visible !== false && f.type === "IMAGE")) pics++; for (const c of x.children || []) w(c); })(n); return { texts: t, pics }; };
const sameCopy = (a, b) => {
  if (!a.texts.size && !b.texts.size) return true; // two silent graphics in one place: one drawn twice
  if (!a.texts.size || !b.texts.size) return false;
  const shared = [...a.texts].filter((x) => b.texts.has(x)).length;
  return shared / Math.min(a.texts.size, b.texts.size) >= 0.8;
};
const layerIds = {}; // section name -> extra top-level node ids built into the same section
if (!flag("keep-duplicates")) {
  for (const s of sections) {
    for (const o of sections) {
      if (o === s || skipReason[s.name] || skipReason[o.name] || iou(s.box, o.box) < 0.9) continue;
      const sNode = top.find((n) => n.id === s.id), oNode = top.find((n) => n.id === o.id);
      const sCopy = copyOf(sNode), oCopy = copyOf(oNode);
      if (!sameCopy(sCopy, oCopy)) {
        // layers of one section: the one with the copy is the section, the picture-only one is built into it (as its backdrop)
        if (oCopy.texts.size && !sCopy.texts.size) { (layerIds[o.name] ||= []).push(s.id); skipReason[s.name] = `layer of ${o.name} (built into it as backdrop)`; break; }
        continue;
      }
      const sDone = fs.existsSync(path.join(secRoot, s.name, "normalized.json")), oDone = fs.existsSync(path.join(secRoot, o.name, "normalized.json"));
      if ((oDone && !sDone) || (oDone === sDone && o.index < s.index)) { skipReason[s.name] = `duplicate of ${o.name} (same position and size)`; break; }
    }
  }
}
// Backdrops: a content-less solid rectangle that lies behind other top-level sections is their background, not a section of its own
// (built as a section it became an empty block as tall as everything it sits behind, pushing the content down).
const backdrops = [];
for (const s of sections) {
  if (skipReason[s.name]) continue;
  const n = top.find((x) => x.id === s.id);
  const fill = (n.fills || []).find((f) => f.visible !== false);
  if (n.type !== "RECTANGLE" || n.children?.length || fill?.type !== "SOLID" || (fill.opacity ?? 1) < 1) continue;
  const covered = sections.filter((o) => o !== s && !skipReason[o.name] && o.box.y >= s.box.y - 1 && o.box.y + o.box.height <= s.box.y + s.box.height + 1
    && o.box.x + o.box.width > s.box.x && o.box.x < s.box.x + s.box.width && copyOf(top.find((x) => x.id === o.id)).texts.size > 0);
  if (!covered.length) continue;
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  backdrops.push({ rectId: s.id, color: ("#" + hex(fill.color.r) + hex(fill.color.g) + hex(fill.color.b)).toUpperCase(), sections: covered.map((o) => o.name) });
  skipReason[s.name] = `backdrop behind ${covered.map((o) => o.name).join(", ")} (applied as their background)`;
}
// Non-rectangular painted backgrounds (for example a curved boolean union)
// must share a section with the content above them, not become an empty band.
for(const s of sections){
 if(skipReason[s.name])continue;
 const n=top.find(n=>n.id===s.id);
 if(!['BOOLEAN_OPERATION','VECTOR'].includes(n.type)||copyOf(n).texts.size)continue;
 const covered=sections.filter(o=>o!==s&&!skipReason[o.name]&&o.box.y>=s.box.y-1&&o.box.y+o.box.height<=s.box.y+s.box.height+1&&o.box.x>=s.box.x-1&&o.box.x+o.box.width<=s.box.x+s.box.width+1&&copyOf(top.find(n=>n.id===o.id)).texts.size);
 if(!covered.length)continue;
 const owner=covered[0];
 layerIds[owner.name]=[...new Set([...(layerIds[owner.name]||[]),s.id,...covered.slice(1).map(o=>o.id)])];
 skipReason[s.name]=`painted background included in ${owner.name}`;
 for(const other of covered.slice(1))skipReason[other.name]=`content included in ${owner.name} with shared painted background`;
}
// Loose top-level artwork/copy in the same vertical band forms one section.
// Connected overlap captures an image beside several stacked text nodes and
// equal-height card rows without relying on layer names or saved section maps.
let bandOwner=null,bandBottom=-Infinity;
for(const s of sections){
 if(skipReason[s.name])continue;
 const members=[s.id,...(layerIds[s.name]||[])].map(id=>top.find(n=>n.id===id)?.absoluteBoundingBox).filter(Boolean);
 const start=Math.min(...members.map(b=>b.y)),end=Math.max(...members.map(b=>b.y+b.height));
 if(bandOwner&&start<bandBottom-1){
  layerIds[bandOwner.name]=[...new Set([...(layerIds[bandOwner.name]||[]),s.id,...(layerIds[s.name]||[])])];
  skipReason[s.name]=`same vertical content band as ${bandOwner.name}`;
  for(const backdrop of backdrops)if(backdrop.sections.includes(s.name))backdrop.sections=[...new Set(backdrop.sections.map(name=>name===s.name?bandOwner.name:name))];
  bandBottom=Math.max(bandBottom,end);
 }else{bandOwner=s;bandBottom=end;}
}
fs.writeFileSync(path.join(frameDir, "backdrops.json"), JSON.stringify(backdrops, null, 2));
const nodeIdsOf = (s) => [...(layerIds[s.name] || []), s.id].sort((a, b) => top.findIndex((n) => n.id === a) - top.findIndex((n) => n.id === b)).map((id) => top.find((n) => n.id === id).id);
const isSkipped = (s) => !!skipReason[s.name];
const picked = (s) => !isSkipped(s) && (!only || only.has(s.name) || only.has(s.id));
const normalizedOf = (s) => path.join(secRoot, s.name, "normalized.json");
const isDone = (s) => fs.existsSync(normalizedOf(s));

// ---- plan ----
console.log(`\n${top.length} top-level section(s) in ${frameDir}:\n`);
for (const s of sections) {
  const state = isSkipped(s) ? `SKIPPED: ${skipReason[s.name]}` : isDone(s) ? (flag("force") && picked(s) ? "redo (--force)" : "done") : "to do";
  console.log(`  ${String(s.index).padStart(2)}  ${s.id.padEnd(9)} ${s.name.padEnd(14)} ${String(Math.round(s.box.width)).padStart(4)}x${String(Math.round(s.box.height)).padEnd(5)} ${state.padEnd(15)} "${String(s.figmaName).slice(0, 30)}"${picked(s) ? "" : "  (not selected)"}`);
}
if (flag("dry-run")) { console.log(`\nDry run - nothing was run. Names are in ${namesPath}.`); process.exit(0); }

// ---- run ----
let lastOut = "";
function node(script, a, live = false) {
  console.log(`\n=== node scripts/${script} ${a.join(" ")} ===`);
  // live: the model step takes many minutes (one call per part, 65s apart) - show its output as it happens instead of after it ends
  if (live) {
    const r = spawnSync(process.execPath, [path.join("scripts", script), ...a], { stdio: "inherit" });
    lastOut = "";
    return r.status === 0;
  }
  const r = spawnSync(process.execPath, [path.join("scripts", script), ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["inherit", "pipe", "pipe"] });
  lastOut = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
  return r.status === 0;
}
const failed = [];
const failedNames = new Set();
const split = opt("split", process.env.AI_PROVIDER === 'codex' ? "24000" : "4600");
const normalizationMode = flag("deterministic") || process.env.NORMALIZE_MODE === "deterministic" ? "deterministic" : "ai";
let merged = false;
fs.writeFileSync(path.join(frameDir, "build-report.json"), JSON.stringify({ status: "running", merged: false }));
for (const s of sections) {
  if (!picked(s)) continue;
  const dir = path.join(secRoot, s.name);
  const sourceHash = createHash("sha256").update(JSON.stringify(nodeIdsOf(s).map((id) => top.find((n) => n.id === id)))).digest("hex");
  const metaPath = path.join(dir, "normalized-source.json");
  let cachedHash = null;
  let cachedMode = null;
  if (fs.existsSync(metaPath)) { try { const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8")); cachedHash = metadata.hash; cachedMode = metadata.mode; } catch {} }
  const changed = (cachedHash && cachedHash !== sourceHash) || (isDone(s) && ((cachedMode && cachedMode !== normalizationMode) || (normalizationMode === "deterministic" && !cachedMode)));
  if (changed) console.log(`\n--- ${s.name}: Figma input changed, rebuilding normalization.`);
  if (!isDone(s) || flag("force") || changed) {
    // --force means redo: saved parts would otherwise be reused by --resume, and they were answered for the old input
    if (flag("force") && fs.existsSync(path.join(dir, "parts"))) {
      const partsPath = path.resolve(dir, "parts"), sectionRoot = path.resolve(secRoot) + path.sep;
      if (!partsPath.startsWith(sectionRoot)) throw new Error("Parts path is outside the section workspace.");
      fs.rmSync(partsPath, { recursive: true, force: true }); console.log(`\n--- ${s.name}: removed saved parts (--force)`);
    }
    const ok = node("2_normalize.js", [frameDir, `--nodes=${nodeIdsOf(s).join(",")}`, `--name=${s.name}`, `--split=${split}`, "--resume", ...(flag("deterministic") ? ["--deterministic"] : [])], true);
    if (!ok || !isDone(s)) { failedNames.add(s.name); failed.push(`${s.name} (${s.id}): model step failed, section left out - re-run the same command to retry it, or add --skip=${s.name} to leave it out on purpose`); continue; }
  } else {
    console.log(`\n--- ${s.name}: already normalized, skipping the model step (use --force to redo)`);
  }
  fs.writeFileSync(metaPath, JSON.stringify({ hash: sourceHash, figmaNodeId: s.id, mode: normalizationMode }, null, 2));
  if (!node("3_compile_bricks.js", [dir])) { failedNames.add(s.name); failed.push(`${s.name} (${s.id}): compile failed`); }
  else {
    // The compile step lists Figma text that never made it into the section. A few lost texts (a nav bar, a card body) mean the model
    // dropped part of the section, even though it validated. Do not let that pass silently.
    const lost = (lastOut.match(/MISSING TEXT/g) || []).length;
    if (lost >= 3) failed.push(`${s.name} (${s.id}): INCOMPLETE - ${lost} Figma text(s) are missing from it. Redo it with: --only=${s.name} --force`);
  }
}

// ---- merge, in page order, everything that compiled ----
if (!flag("no-merge")) {
  const built = sections.filter((s) => !isSkipped(s) && !failedNames.has(s.name) && fs.existsSync(path.join(secRoot, s.name, "bricks-tree.json")));
  const missing = sections.filter((s) => !isSkipped(s) && !built.includes(s));
  if (!built.length) { failed.push("nothing compiled for this run"); console.log("\nNothing compiled yet - nothing to merge."); }
  else {
    if (missing.length) console.log(`\nNote: ${missing.length} section(s) are not built yet and are left out of the merge: ${missing.map((s) => s.name).join(", ")}`);
    if (!node("merge_sections.js", [frameDir, ...built.map((s) => s.name)])) failed.push("merge failed");
    else if (!node("wrap-template.js", [path.join(frameDir, "merged"), opt("template-name", `${path.basename(frameDir)} page`)])) failed.push("template wrap failed");
    else { merged = true; console.log(`\nImport this into Bricks: ${path.join(frameDir, "merged", "bricks-template-import.json")}`); }
  }
}

const skippedList = sections.filter(isSkipped);
if (skippedList.length) console.log(`\nSkipped ${skippedList.length} section(s): ${skippedList.map((s) => `${s.name} (${skipReason[s.name]})`).join("; ")}`);
console.log(failed.length ? `\n${failed.length} problem(s):\n${failed.map((f) => "  - " + f).join("\n")}` : "\nAll selected sections built.");
fs.writeFileSync(path.join(frameDir, "build-report.json"), JSON.stringify({ status: failed.length ? "incomplete" : "built", merged, failures: failed, failedSections: [...failedNames], finishedAt: new Date().toISOString() }, null, 2));
process.exit(failed.length ? 1 : 0);
