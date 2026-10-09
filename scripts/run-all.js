/**
 * Runs stages 1-3 end to end for one frame. Stops before injection/measurement
 * since those need a real target page id and a reachable URL you confirm.
 *
 * Usage:
 *   node scripts/run-all.js "<figma-url-with-node-id>"
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const figmaUrl = process.argv[2];
if (!figmaUrl) {
  console.error('Usage: node scripts/run-all.js "<figma-url>"');
  process.exit(1);
}

function run(script, args) {
  console.log(`\n=== ${script} ${args.join(" ")} ===`);
  execFileSync("node", [`scripts/${script}`, ...args], { stdio: "inherit" });
}

run("1_extract_figma.js", [figmaUrl]);

// Figure out which output/<frame-name> dir stage 1 just created (most recently modified).
const dirs = fs
  .readdirSync("output")
  .map((d) => ({ d, t: fs.statSync(`output/${d}`).mtimeMs }))
  .sort((a, b) => b.t - a.t);
const frameDir = `output/${dirs[0].d}`;
console.log(`\nUsing frame dir: ${frameDir}`);

run("2_normalize.js", [frameDir]);
run("3_compile_bricks.js", [frameDir]);
run("bricks-validator.js", [`${frameDir}/bricks-tree.json`]);

console.log(
  `\nDone through stage 3. Review ${frameDir}/bricks-tree.json, then when ready:\n` +
    `  node scripts/4_inject.js ${frameDir} <wp-page-id>\n` +
    `  node scripts/5_measure.js ${frameDir} <page-url> "<selector>"`
);