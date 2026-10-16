/** Nonvisual build checks. This module never launches a browser or calls AI. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBricks } from "./bricks-validator.js";
import { validateNativeComponents } from "./native-components.js";

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema/runtime");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
export function validateBuild(tree, treeDir, { runtimeDir = schemaDir } = {}) {
  const result = validateBricks(tree, { strict: true }), native = validateNativeComponents(Array.isArray(tree) ? tree : []), errors = [...result.errors, ...native.errors], warnings = [...result.warnings, ...(native.warnings || [])];
  const schemas = new Map();
  const manifestFile = path.join(runtimeDir, "manifest.json");
  const contextFile = path.join(runtimeDir, "site-context.json");
  const context = fs.existsSync(contextFile) ? read(contextFile) : {};
  const knownClasses = new Set((context.designSystem?.globalClasses || []).map(c => c.id));
  if (fs.existsSync(manifestFile)) for (const type of read(manifestFile).elements || []) {
    const file = path.join(runtimeDir, `${type}.json`);
    if (fs.existsSync(file)) schemas.set(type, read(file));
  }
  const assets = new Set();
  function media(value, field = "") {
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if (["url", "full"].includes(key) && typeof v === "string" && ["image", "svg"].includes(field) && !/^(https?:|data:|\/\/)/i.test(v)) {
        const absolute = path.resolve(treeDir, v); assets.add(absolute);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) errors.push(`Missing media asset: ${v}`);
      }
      if (v && typeof v === "object") media(v, key);
    }
  }
  if (Array.isArray(tree)) for (const e of tree) {
    if (!e || typeof e !== "object") continue;
    const schema = schemas.get(e.name), settings = e.settings || {};
    if (!schema) errors.push(`Element ${e.id}: ${e.name} has no verified runtime schema. Sync the installed Bricks schema before compiling this type.`);
    for (const [key, value] of Object.entries(settings)) {
      const base = key.split(":")[0], control = schema?.controls?.[base];
      if (schema && !control) errors.push(`Element ${e.id} (${e.name}): unsupported setting ${key}.`);
      if(e.name==='nav-menu' && base==='menu' && control){
        if(!Number.isInteger(Number(value)) || Number(value)<1) errors.push(`Element ${e.id}: WordPress menu must be a positive term ID.`);
        continue; // Runtime schema omits the site's dynamic menu choices.
      }
      // Only validate closed choice lists. Dynamic data/CSS variables are resolved
      // by Bricks and cannot be validated as literal choices here.
      if (control?.type === "select" && control.options) for (const choice of Array.isArray(value) ? value : [value]) if (typeof choice === "string" && choice && !/[{}]|var\(/.test(choice) && !Object.hasOwn(control.options, choice)) errors.push(`Element ${e.id}: invalid choice ${JSON.stringify(choice)} for ${key}.`);
    }
    if (settings._cssGlobalClasses) {
      if (!Array.isArray(settings._cssGlobalClasses)) errors.push(`Element ${e.id}: global class references must be an array of existing IDs.`);
      else for (const id of settings._cssGlobalClasses) if (!knownClasses.has(id)) errors.push(`Element ${e.id}: global class ${id} is not in the saved site's design context. Refresh schema:sync or select an existing class.`);
    }
    if (settings._display === "grid" && !settings._gridTemplateColumns && !Object.keys(settings).some(k => k.startsWith("_gridTemplateColumns:"))) warnings.push(`Element ${e.id}: grid has no explicit columns; Bricks will use its default.`);
    media(settings);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], elementCount: Array.isArray(tree) ? tree.length : 0, checkedAssets: assets.size, validation: "structural, supported keys/choices, local media; no frontend or visual assertions" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/validate-build.js <bricks-tree.json>"); process.exitCode = 1; }
  else {
    try {
      const tree = read(file), result = validateBuild(tree, path.dirname(path.resolve(file)));
      fs.writeFileSync(path.join(path.dirname(file), "validation-report.json"), JSON.stringify(result, null, 2));
      console.log(`${result.elementCount} elements, ${result.checkedAssets} local assets: ${result.errors.length} errors, ${result.warnings.length} warnings.`);
      for (const error of result.errors) console.error(error);
      for (const warning of result.warnings.slice(0, 15)) console.warn(warning);
      process.exitCode = result.errors.length ? 1 : 0;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
