/** Resumable Figma -> Bricks pipeline. Only nonvisual validation gates injection. */
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const valued = new Set(["--page", "--title", "--frame", "--only", "--split", "--skip", "--visual-iterations"]);
const val = (name) => { const i = args.indexOf(name); if (i >= 0) { if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value`); return args[i + 1]; } return args.find((a) => a.startsWith(name + "="))?.slice(name.length + 1); };
const has = (name) => args.includes(name);
const url = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const allowed = new Set([...valued, "--refresh", "--no-inject", "--inject-partial", "--strict", "--force", "--keep-duplicates", "--no-dataset", "--no-visual", "--visual-review-only", "--deterministic"]);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const steps = [], state = { figmaUrl: url || null, frameDir: null, postId: null, startedAt: new Date().toISOString() };
let runDir, logFile, pendingLog = "";
function write(s) { process.stdout.write(s); if (logFile) fs.appendFileSync(logFile, s); else pendingLog += s; }
const log = (s) => write(s + "\n");
function run(label, script, argv) {
  return new Promise((resolve) => {
    log(`\n=== ${label}: node scripts/${script} ${argv.join(" ")} ===`);
    const started = Date.now(); let out = "", settled = false;
    const child = spawn(process.execPath, [path.join("scripts", script), ...argv], { stdio: ["inherit", "pipe", "pipe"], env: process.env });
    const done = (code, error) => { if (settled) return; settled = true; steps.push({ label, script, args: argv, code, seconds: Math.round((Date.now() - started) / 1000), ...(error ? { error } : {}) }); resolve({ code, out }); };
    const onData = (d) => { const s = d.toString(); out += s; write(s); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("error", (e) => { log(e.message); done(1, e.message); });
    child.on("close", (code) => done(code ?? 1));
  });
}
async function main() {
  for (const arg of args.filter((a) => a.startsWith("--"))) if (!allowed.has(arg.split("=")[0])) throw new Error(`Unknown option ${arg}`);
  if (has("--visual-review-only") || val("--visual-iterations")) throw new Error('Visual debugging is manual only. Use npm run visual with --only, --problem and --page-url after inspecting the frontend.');
  let frameDir = val("--frame");
  if (!url && !frameDir) throw new Error('Usage: npm run pipeline -- "<figma-url>" [--page <id>] [--no-inject] [--deterministic]');
  if (val("--page") && (!/^\d+$/.test(val("--page")) || Number(val("--page")) < 1)) throw new Error("--page must be a positive numeric post ID.");
  if (has("--strict") && has("--inject-partial")) throw new Error("--strict and --inject-partial cannot be combined.");
  if (!frameDir) {
    const extraction = await run("1 extract", "1_extract_figma.js", [url, ...(has("--refresh") ? ["--refresh"] : [])]);
    if (extraction.code) throw new Error("Figma extraction failed.");
    frameDir = [...extraction.out.matchAll(/Output in (.+)[\\/]\s*$/gm)].at(-1)?.[1];
    if (!frameDir) throw new Error("Extraction did not identify its output folder.");
  }
  if (!fs.existsSync(path.join(frameDir, "figma-node.json"))) throw new Error(`No figma-node.json in ${frameDir}`);
  state.frameDir = frameDir;
  runDir = path.join(frameDir, "runs", stamp); fs.mkdirSync(runDir, { recursive: true });
  logFile = path.join(runDir, "run.log"); fs.writeFileSync(logFile, pendingLog); pendingLog = "";
  if (url) fs.writeFileSync(path.join(frameDir, "source.json"), JSON.stringify({ figmaUrl: url, extractedAt: new Date().toISOString() }, null, 2));
  log(`Frame folder: ${frameDir}`);
  const sectionArgs = [frameDir];
  for (const name of ["--force", "--keep-duplicates", "--deterministic"]) if (has(name)) sectionArgs.push(name);
  for (const name of ["--only", "--split", "--skip"]) if (val(name)) sectionArgs.push(`${name}=${val(name)}`);
  const reportFile = path.join(frameDir, "build-report.json");
  // A failed child must not inherit a previous successful build report.
  fs.writeFileSync(reportFile, JSON.stringify({ status: "pending", merged: false }));
  const build = await run("2-3 normalize, compile, merge", "run-sections.js", sectionArgs);
  const buildReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  if (!buildReport.merged) throw new Error("This run did not produce a merge; old merged output will not be injected.");
  const mergedDir = path.join(frameDir, "merged"), mergedTree = path.join(mergedDir, "bricks-tree.json");
  if ((await run("validate merged tree", "bricks-validator.js", [mergedTree])).code) throw new Error("Merged tree failed structural validation.");
  if ((await run("validate native settings and assets", "validate-build.js", [mergedTree])).code) throw new Error("Merged build failed nonvisual schema/asset validation.");
  state.visualDebugging = "manual-only; never invoked by the pipeline";
  let failed = !!build.code;
  const blocked = build.code && !has("--inject-partial");
  if (has("--no-inject")) log("WordPress injection skipped (--no-inject).");
  else if (blocked) log("WordPress injection stopped because this build has unresolved failures.");
  else {
    const injectArgs = [mergedDir, "--fix-keys", "--report-dir", path.join(runDir, "mcp")];
    if (val("--page")) injectArgs.push("--page", val("--page"));
    else injectArgs.push("--title", val("--title") || `Figma import - ${path.basename(frameDir)} ${new Date().toISOString().slice(0, 10)}`);
    const injected = await run("4 inject into Bricks", "4_inject_mcp.js", injectArgs);
    failed = !!injected.code || failed;
    if (!injected.code) {
      const report = JSON.parse(fs.readFileSync(path.join(mergedDir, "inject-report.json"), "utf8")); state.postId = report.postId;
      for (const file of ["inject-report.json", "injected-tree.json"]) fs.copyFileSync(path.join(mergedDir, file), path.join(runDir, file));
    }
  }
  fs.copyFileSync(mergedTree, path.join(runDir, "compiled-tree.json"));
  if (!has("--no-dataset")) {
    const datasetArgs = [frameDir, "--run", runDir];
    if (state.postId) datasetArgs.push("--page", String(state.postId));
    const exported = await run("5 export dataset", "export-dataset.js", datasetArgs);
    failed = !!exported.code || failed;
  }
  log(failed ? "\nFinished with failures. See run.json and run.log." : "\nCompleted. Frontend layout and interactive behavior await manual inspection.");
  return failed ? 1 : 0;
}
let exitCode = 1;
try { exitCode = await main(); } catch (error) { state.error = error.message; log(`\nSTOPPED: ${error.message}`); }
if (!runDir) { runDir = path.join("output", "pipeline-runs", stamp); fs.mkdirSync(runDir, { recursive: true }); fs.writeFileSync(path.join(runDir, "run.log"), pendingLog); }
fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ ...state, args, steps, finishedAt: new Date().toISOString(), exitCode }, null, 2));
process.exitCode = exitCode;
