/**
 * ONE COMMAND: Figma -> extract -> AI normalize -> compile -> merge -> push into a Bricks page -> save everything as a dataset.
 *
 *   node --env-file=.env scripts/pipeline.js "<figma-url-with-node-id>"                      new draft page
 *   node --env-file=.env scripts/pipeline.js "<figma-url>" --page 123                         write into page 123
 *   node --env-file=.env scripts/pipeline.js "<figma-url>" --title "Jili home" --split=4600
 *
 * Options
 *   --page <id> | --title "<t>"   target page (default: new DRAFT page "Figma import - <frame> <date>")
 *   --frame output/<name>         skip stage 1 and use an existing frame folder (no URL needed)
 *   --no-inject                   build everything, do not touch WordPress
 *   --inject-partial              push even when some sections failed (default: stop before WordPress)
 *   --force                       redo the AI step for finished sections (spends tokens)
 *   --only=a,b   --split=N        passed to run-sections.js
 *   --no-dataset                  do not write the dataset
 *
 * Every run writes output/<frame>/runs/<timestamp>/ (run.json + run.log) and refreshes output/<frame>/dataset/ (see export-dataset.js).
 * Stages are resumable: re-running the same command reuses the cached Figma data, assets and finished sections.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); if (i >= 0) return args[i + 1]; const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : undefined; };
const has = (n) => args.includes(n);
const valued = new Set(["--page", "--title", "--frame"]);
const url = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
let frameDir = val("--frame");
if (!url && !frameDir) { console.error('Usage: node --env-file=.env scripts/pipeline.js "<figma-url-with-node-id>" [--page <id> | --title "<t>"] [--no-inject] [--force]'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const steps = [];
let logStream = null;
const log = (s) => { process.stdout.write(s + "\n"); logStream?.write(s + "\n"); };

function run(label, script, a, { capture } = {}) {
  return new Promise((resolve) => {
    log(`\n=== ${label}: node scripts/${script} ${a.join(" ")} ===`);
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join("scripts", script), ...a], { stdio: ["inherit", "pipe", "pipe"], env: process.env });
    let out = "";
    const onData = (d) => { const s = d.toString(); out += s; process.stdout.write(s); logStream?.write(s); };
    p.stdout.on("data", onData); p.stderr.on("data", onData);
    p.on("close", (code) => { steps.push({ label, script, args: a, code, seconds: Math.round((Date.now() - t0) / 1000) }); resolve({ code, out }); });
  });
}
const fail = (m) => { log(`\nSTOPPED: ${m}`); finish(1); };
let state = { figmaUrl: url || null, frameDir: null, postId: null, startedAt: new Date().toISOString() };
function finish(code) {
  if (state.frameDir) {
    const dir = path.join(state.frameDir, "runs", stamp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ ...state, args, steps, finishedAt: new Date().toISOString(), exitCode: code }, null, 2));
  }
  logStream?.end();
  process.exit(code);
}

// ---- 1. extract ----
if (!frameDir) {
  const before = new Map();
  if (fs.existsSync("output")) for (const d of fs.readdirSync("output")) { const f = path.join("output", d, "figma-node.json"); if (fs.existsSync(f)) before.set(d, fs.statSync(f).mtimeMs); }
  const r = await run("1/5 extract from Figma", "1_extract_figma.js", [url]);
  if (r.code !== 0) fail("Figma extraction failed (check FIGMA_TOKEN and the URL).");
  const touched = fs.readdirSync("output").map((d) => ({ d, f: path.join("output", d, "figma-node.json") })).filter((x) => fs.existsSync(x.f))
    .map((x) => ({ ...x, t: fs.statSync(x.f).mtimeMs, changed: !before.has(x.d) || before.get(x.d) !== fs.statSync(x.f).mtimeMs }))
    .sort((a, b) => Number(b.changed) - Number(a.changed) || b.t - a.t);
  const m = /output[\\/]([^\\/\s]+)[\\/]/.exec(r.out);
  frameDir = path.join("output", (m && fs.existsSync(path.join("output", m[1], "figma-node.json")) ? m[1] : touched[0]?.d) || "");
}
if (!fs.existsSync(path.join(frameDir, "figma-node.json"))) { console.error(`No figma-node.json in ${frameDir}`); process.exit(1); }
state.frameDir = frameDir;
fs.mkdirSync(path.join(frameDir, "runs", stamp), { recursive: true });
logStream = fs.createWriteStream(path.join(frameDir, "runs", stamp, "run.log"));
if (url) fs.writeFileSync(path.join(frameDir, "source.json"), JSON.stringify({ figmaUrl: url, extractedAt: new Date().toISOString() }, null, 2));
log(`Frame folder: ${frameDir}`);

// ---- 2+3. AI normalize + compile + merge (run-sections.js) ----
const rs = [frameDir];
for (const f of ["--force"]) if (has(f)) rs.push(f);
for (const o of ["--only", "--split"]) { const v = val(o); if (v) rs.push(`${o}=${v}`); }
const r2 = await run("2-3/5 AI normalize + compile + merge", "run-sections.js", rs);
const sectionsFailed = r2.code !== 0;
const mergedTree = path.join(frameDir, "merged", "bricks-tree.json");
if (!fs.existsSync(mergedTree)) fail("nothing was compiled, so there is nothing to push.");

// ---- 4. inject ----
if (has("--no-inject")) log("\n4/5 push to WordPress: skipped (--no-inject)");
else if (sectionsFailed && !has("--inject-partial")) log("\n4/5 push to WordPress: SKIPPED because some sections failed. Re-run the same command (it resumes), or add --inject-partial.");
else {
  const ia = [path.join(frameDir, "merged"), "--fix-keys"];
  if (val("--page")) ia.push("--page", val("--page"));
  else ia.push("--title", val("--title") || `Figma import - ${path.basename(frameDir)} ${new Date().toISOString().slice(0, 10)}`);
  const r4 = await run("4/5 push into Bricks page", "4_inject_mcp.js", ia);
  if (r4.code !== 0) log("\nWordPress push failed. Everything built so far is saved; fix the error above and re-run (cached steps are skipped).");
  else {
    try { state.postId = JSON.parse(fs.readFileSync(path.join("output", "mcp-inject-merged.json"), "utf8")).postId; } catch {}
    const rep = path.join("output", "mcp-inject-merged.json");
    if (fs.existsSync(rep)) fs.copyFileSync(rep, path.join(frameDir, "runs", stamp, "inject-report.json"));
    const rn = path.join("output", "mcp-fixed-tree-merged.json");
    if (fs.existsSync(rn)) fs.copyFileSync(rn, path.join(frameDir, "runs", stamp, "fixed-tree.json"));
  }
}

// ---- 5. dataset ----
if (!has("--no-dataset")) {
  const da = [frameDir];
  if (state.postId) da.push("--page", String(state.postId));
  await run("5/5 save dataset", "export-dataset.js", da);
}

log(`\nDone${sectionsFailed ? " (with failed sections - see above)" : ""}.`);
log(`  frame folder : ${frameDir}`);
log(`  dataset      : ${path.join(frameDir, "dataset")}`);
if (state.postId) log(`  Bricks page  : ${state.postId}   (after you edit it in the builder: node --env-file=.env scripts/export-dataset.js ${frameDir} --page ${state.postId} --sync)`);
finish(sectionsFailed ? 1 : 0);