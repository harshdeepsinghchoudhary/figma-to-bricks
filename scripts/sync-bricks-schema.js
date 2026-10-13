// Read runtime controls from the configured Bricks site; no site content is changed.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const types = ["section", "container", "div", "block", "heading", "text", "text-basic", "button", "image", "icon"];
const temp = path.resolve(".review-work", `schema-sync-${Date.now()}`); fs.mkdirSync(temp, { recursive: true });
const collected = {};
for (const name of types) {
  const argsFile = path.join(temp, `${name}-args.json`); fs.writeFileSync(argsFile, JSON.stringify({ elementName: name }));
  const result = spawnSync(process.execPath, ["scripts/test-mcp.mjs", "run", "bricks/get-element-schema", "@" + argsFile], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Cannot read ${name} schema: ${(result.stderr || result.stdout).slice(-800)}`);
  const raw = JSON.parse(fs.readFileSync("output/run-bricks_get-element-schema.json", "utf8"));
  const schema = raw.data || raw;
  if (raw.success === false || schema.name !== name || !schema.controls || Array.isArray(schema.controls)) throw new Error(`Unexpected runtime schema for ${name}`);
  collected[name] = schema;
  console.log(`${name}: ${Object.keys(schema.controls).length} registered control keys`);
}
const dir = path.resolve("schema", "runtime"); fs.mkdirSync(dir, { recursive: true });
for (const [name, schema] of Object.entries(collected)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(schema, null, 2));
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ source: "Bricks runtime get-element-schema", site: new URL(process.env.WP_API_URL).origin, fetchedAt: new Date().toISOString(), elements: types }, null, 2));
console.log(`Runtime schemas saved in ${dir}. No WordPress content was changed.`);
