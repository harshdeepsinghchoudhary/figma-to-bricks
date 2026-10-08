/**
 * Stage 5: measure rendered page vs Figma spec.
 *
 * This intentionally does NOT reimplement measurement — it shells out to the
 * scripts from the figma-to-wordpress SKILL repo, which already do this well:
 *
 *   figma-geom.py    -> canonical geometry from a Figma node (the "truth")
 *   dom-measure.js   -> getBoundingClientRect()/getComputedStyle() from the
 *                       rendered page for the same selectors
 *   overflow-sweep.js -> hard gate: any horizontal overflow across viewports
 *
 * Usage:
 *   node scripts/5_measure.js output/<frame-name> <page-url> <css-selector...>
 *
 * Example:
 *   node scripts/5_measure.js output/hero-section \
 *     http://localhost:10004/homepage/ \
 *     ".hero" ".hero h1" ".hero .btn-primary"
 *
 * Point SKILL_REPO_PATH at wherever you kept the figma-to-wordpress-main repo.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const [frameDir, pageUrl, ...selectors] = process.argv.slice(2);
if (!frameDir || !pageUrl || selectors.length === 0) {
  console.error(
    'Usage: node scripts/5_measure.js output/<frame-name> <page-url> "<selector>" ["<selector>" ...]'
  );
  process.exit(1);
}

const SKILL_REPO_PATH = process.env.SKILL_REPO_PATH || "../figma-to-wordpress-main";

function checkRepo() {
  const p = path.resolve(SKILL_REPO_PATH, "scripts", "dom-measure.js");
  if (!fs.existsSync(p)) {
    console.error(
      `Can't find dom-measure.js at ${p}.\n` +
        `Set SKILL_REPO_PATH in .env to the folder where you unzipped figma-to-wordpress-main.`
    );
    process.exit(1);
  }
}
checkRepo();

console.log("--- DOM measurement (rendered page) ---");
try {
  execFileSync(
    "node",
    [path.join(SKILL_REPO_PATH, "scripts", "dom-measure.js"), pageUrl, "1440", ...selectors],
    { stdio: "inherit" }
  );
} catch (e) {
  console.error("dom-measure.js failed — is the page reachable at", pageUrl, "?");
}

console.log("\n--- Overflow sweep (multi-viewport gate) ---");
try {
  execFileSync(
    "node",
    [
      path.join(SKILL_REPO_PATH, "scripts", "overflow-sweep.js"),
      pageUrl,
      "360,390,768,991,1024,1280,1440,1680,1920",
    ],
    { stdio: "inherit" }
  );
} catch (e) {
  console.warn("Overflow detected at one or more widths — see output above.");
}

console.log(
  "\n--- Figma geometry (compare by hand for now) ---\n" +
    `Run: python3 ${path.join(SKILL_REPO_PATH, "scripts", "figma-geom.py")} on your figma-node.json\n` +
    `and diff its numbers against the dom-measure.js output above.\n` +
    "Wiring an automatic diff + LLM correction is milestone 2 — see README."
);
