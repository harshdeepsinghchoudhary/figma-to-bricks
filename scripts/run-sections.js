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
const top = [...(root.children || [])]
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
if (!flag("keep-duplicates")) {
  for (const s of sections) {
    for (const o of sections) {
      if (o === s || skipReason[s.name] || skipReason[o.name] || iou(s.box, o.box) < 0.9) continue;
      const sDone = fs.existsSync(path.join(secRoot, s.name, "normalized.json")), oDone = fs.existsSync(path.join(secRoot, o.name, "normalized.json"));
      if ((oDone && !sDone) || (oDone === sDone && o.index < s.index)) { skipReason[s.name] = `duplicate of ${o.name} (same position and size)`; break; }
    }
  }
}
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
const split = opt("split", "4600");
for (const s of sections) {
  if (!picked(s)) continue;
  const dir = path.join(secRoot, s.name);
  if (!isDone(s) || flag("force")) {
    // --force means redo: saved parts would otherwise be reused by --resume, and they were answered for the old input
    if (flag("force") && fs.existsSync(path.join(dir, "parts"))) { fs.rmSync(path.join(dir, "parts"), { recursive: true, force: true }); console.log(`\n--- ${s.name}: removed saved parts (--force)`); }
    const ok = node("2_normalize.js", [frameDir, `--nodes=${s.id}`, `--name=${s.name}`, `--split=${split}`, "--resume"], true);
    if (!ok || !isDone(s)) { failed.push(`${s.name} (${s.id}): model step failed, section left out - re-run the same command to retry it, or add --skip=${s.name} to leave it out on purpose`); continue; }
  } else {
    console.log(`\n--- ${s.name}: already normalized, skipping the model step (use --force to redo)`);
  }
  if (!node("3_compile_bricks.js", [dir])) failed.push(`${s.name} (${s.id}): compile failed`);
  else {
    // The compile step lists Figma text that never made it into the section. A few lost texts (a nav bar, a card body) mean the model
    // dropped part of the section, even though it validated. Do not let that pass silently.
    const lost = (lastOut.match(/MISSING TEXT/g) || []).length;
    if (lost >= 3) failed.push(`${s.name} (${s.id}): INCOMPLETE - ${lost} Figma text(s) are missing from it. Redo it with: --only=${s.name} --force`);
  }
}

// ---- merge, in page order, everything that compiled ----
if (!flag("no-merge")) {
  const built = sections.filter((s) => !isSkipped(s) && fs.existsSync(path.join(secRoot, s.name, "bricks-tree.json")));
  const missing = sections.filter((s) => !built.includes(s));
  if (!built.length) console.log("\nNothing compiled yet - nothing to merge.");
  else {
    if (missing.length) console.log(`\nNote: ${missing.length} section(s) are not built yet and are left out of the merge: ${missing.map((s) => s.name).join(", ")}`);
    if (!node("merge_sections.js", [frameDir, ...built.map((s) => s.name)])) failed.push("merge failed");
    else if (!node("wrap-template.js", [path.join(frameDir, "merged"), opt("template-name", `${path.basename(frameDir)} page`)])) failed.push("template wrap failed");
    else console.log(`\nImport this into Bricks: ${path.join(frameDir, "merged", "bricks-template-import.json")}`);
  }
}

const skippedList = sections.filter(isSkipped);
if (skippedList.length) console.log(`\nSkipped ${skippedList.length} section(s): ${skippedList.map((s) => `${s.name} (${skipReason[s.name]})`).join("; ")}`);
console.log(failed.length ? `\n${failed.length} problem(s):\n${failed.map((f) => "  - " + f).join("\n")}` : "\nAll selected sections built.");
process.exit(failed.length ? 1 : 0);