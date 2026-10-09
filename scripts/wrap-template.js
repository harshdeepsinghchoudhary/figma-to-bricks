/**
 * Wrap a compiled bricks-tree.json in the template-export envelope that Bricks
 * itself produces, so it can be imported via Bricks > Templates > Import.
 *
 * Usage:  node scripts/wrap-template.js output/<frame-dir> ["Template title"]
 * Writes: output/<frame-dir>/bricks-template-import.json
 *
 * The envelope keys mirror your real homepage.json export. Site-specific values
 * (id, author, permalink, global variables) are deliberately left out so nothing
 * from that site is imported alongside the test content.
 *
 * NOTE: this envelope is modelled on one real export and has not yet been proven
 * to import. If Bricks rejects it, use the fallback in the README: export any small
 * template from Bricks, and replace only its "content" array with bricks-tree.json.
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const title = process.argv[3] || "Figma import test";
if (!dir) {
  console.error('Usage: node scripts/wrap-template.js output/<frame-dir> ["Template title"]');
  process.exit(1);
}

const treePath = path.join(dir, "bricks-tree.json");
if (!fs.existsSync(treePath)) {
  console.error(`Missing ${treePath} — run stage 3 first.`);
  process.exit(1);
}
const content = JSON.parse(fs.readFileSync(treePath, "utf8"));

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

const envelope = {
  name: title,
  title,
  date,
  thumbnail: null,
  bundles: [],
  tags: [],
  type: "section",
  content,
  templateType: "section",
  globalVariables: [],
  globalVariablesCategories: [],
};

const out = path.join(dir, "bricks-template-import.json");
fs.writeFileSync(out, JSON.stringify(envelope, null, 2));
console.log(`Wrote ${out} (${content.length} elements, templateType "section")`);