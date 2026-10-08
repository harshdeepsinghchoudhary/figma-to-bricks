/**
 * Validate a normalized design JSON against schema/normalized-schema.json,
 * plus the checks JSON Schema cannot express (globally unique ids, assets
 * that actually exist in asset-manifest.json).
 *
 * This is the gate between the LLM and the compiler: LLM output that fails
 * here never reaches 3_compile_bricks.js.
 *
 * CLI:  node scripts/normalized-validator.js output/<frame-dir>
 *       (reads <dir>/normalized.json and, if present, <dir>/asset-manifest.json)
 * Also importable: import { validateNormalized } from "./normalized-validator.js"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  fs.readFileSync(path.join(here, "..", "schema", "normalized-schema.json"), "utf8")
);

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

export function validateNormalized(doc, manifest = null) {
  const errors = [];
  const warnings = [];

  if (!validateSchema(doc)) {
    for (const e of validateSchema.errors) {
      // "if/then" branches produce a noisy generic 'must match "then" schema' line; skip it.
      if (e.keyword === "if") continue;
      errors.push(`${e.instancePath || "(root)"}: ${e.message}${
        e.params && e.params.additionalProperty ? ` "${e.params.additionalProperty}"` : ""
      }${e.params && e.params.allowedValues ? ` (${e.params.allowedValues.join(", ")})` : ""}`);
    }
    return { errors, warnings };
  }

  const seen = new Map();
  const manifestIds = manifest ? new Set(manifest.map((a) => a.nodeId)) : null;

  (function walk(node, trail) {
    for (const child of node.children || []) {
      const here = `${trail}/${child.id}`;
      if (seen.has(child.id)) {
        errors.push(`Duplicate id "${child.id}" at ${here} (first used at ${seen.get(child.id)}).`);
      } else {
        seen.set(child.id, here);
      }
      if (child.asset && manifestIds && !manifestIds.has(child.asset.nodeId)) {
        errors.push(`${here}: asset nodeId "${child.asset.nodeId}" is not in asset-manifest.json.`);
      }
      if (child.type === "unsupported") {
        warnings.push(`${here}: type "unsupported" will be skipped by the compiler. Notes: ${child.notes.join(" | ")}`);
      }
      for (const n of child.notes || []) {
        if (child.type !== "unsupported") warnings.push(`${here}: note: ${n}`);
      }
      walk(child, here);
    }
  })(doc, "");

  return { errors, warnings };
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/normalized-validator.js output/<frame-dir>");
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "normalized.json"), "utf8"));
  const mp = path.join(dir, "asset-manifest.json");
  const manifest = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, "utf8")) : null;

  const { errors, warnings } = validateNormalized(doc, manifest);
  console.log("\n======================================");
  console.log("     NORMALIZED JSON VALIDATOR");
  console.log("======================================\n");
  console.log("Input:", path.join(dir, "normalized.json"), "\n");
  if (errors.length) { console.log(`✗ ${errors.length} error(s):`); errors.forEach((e) => console.log("  -", e)); }
  else console.log("✓ Matches normalized-schema.json.");
  if (warnings.length) { console.log(`\n⚠ ${warnings.length} note(s) for QA:`); warnings.forEach((w) => console.log("  -", w)); }
  console.log("");
  process.exit(errors.length ? 1 : 0);
}