// Backwards-compatible local build entry point. Use pipeline.js for injection and visual QA.
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (!args.length) { console.error('Usage: node scripts/run-all.js "<figma-url>"'); process.exitCode = 1; }
else {
  const result = spawnSync(process.execPath, ["scripts/pipeline.js", ...args, "--no-inject", "--no-visual"], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
