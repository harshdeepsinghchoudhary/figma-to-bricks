// Recompile saved designs in isolated folders; never call models or WordPress.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateBricks } from "../scripts/bricks-validator.js";
import { validateBuild } from "../scripts/validate-build.js";
import { decorationOwner } from "../scripts/section-detect.js";
const out = path.resolve(".review-work", `regression-${Date.now()}`); fs.mkdirSync(out, { recursive: true });
const report = { compiled: 0, failures: [], frames: [], validation: "nonvisual only" };
for (const entry of fs.readdirSync("output", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = path.resolve("output", entry.name), target = path.join(out, entry.name);
  if (!fs.existsSync(path.join(source, "figma-node.json")) && !fs.existsSync(path.join(source, "normalized.json"))) continue;
  fs.mkdirSync(target, { recursive: true });
  for (const file of ["figma-node.json", "sections.json", "normalized.json", "bricks-id-namespace.json"]) if (fs.existsSync(path.join(source, file))) fs.copyFileSync(path.join(source, file), path.join(target, file));
  const responsiveFile = path.join(source, "responsive-frame-map.json");
  if (fs.existsSync(responsiveFile)) {
    const mapping = JSON.parse(fs.readFileSync(responsiveFile, "utf8"));
    for (const reference of Object.values(mapping)) reference.source = path.resolve(source, reference.source);
    fs.writeFileSync(path.join(target, "responsive-frame-map.json"), JSON.stringify(mapping, null, 2));
  }
  const manifestFile = path.join(source, "asset-manifest.json");
  if (fs.existsSync(manifestFile)) fs.writeFileSync(path.join(target, "asset-manifest.json"), JSON.stringify(JSON.parse(fs.readFileSync(manifestFile)).map((a) => ({ ...a, file: path.resolve(source, a.file) }))));
  const compileDirs = fs.existsSync(path.join(target, "normalized.json")) ? [target] : [];
  const sectionsRoot = path.join(source, "sections");
  if (fs.existsSync(sectionsRoot)) for (const name of fs.readdirSync(sectionsRoot)) {
    const section = path.join(sectionsRoot, name); if (!fs.existsSync(path.join(section, "normalized.json"))) continue;
    const dest = path.join(target, "sections", name); fs.mkdirSync(dest, { recursive: true });
    for (const file of ["normalized.json", "prompt-figma.json", "bricks-id-namespace.json"]) if (fs.existsSync(path.join(section, file))) fs.copyFileSync(path.join(section, file), path.join(dest, file));
    compileDirs.push(dest);
  }
  let built = 0;
  for (const dir of compileDirs) {
    const r = spawnSync(process.execPath, ["scripts/3_compile_bricks.js", dir], { encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "compile.log"), (r.stdout || "") + (r.stderr || ""));
    if (r.status !== 0) { report.failures.push({ dir, stage: "compile", error: r.stderr?.slice(-1500) }); continue; }
    const tree = JSON.parse(fs.readFileSync(path.join(dir, "bricks-tree.json")));
    const checked = validateBuild(tree, dir);
    if (checked.errors.length) report.failures.push({ dir, stage: "validate", errors: checked.errors });
    else { built++; report.compiled++; }
  }
  report.frames.push({ name: entry.name, sections: compileDirs.length, built });
  console.log(`${entry.name}: ${built}/${compileDirs.length} compiled and structurally valid`);
  if (entry.name === "casinofx-homepage") {
    const root = JSON.parse(fs.readFileSync(path.join(target, "figma-node.json"))), names = JSON.parse(fs.readFileSync(path.join(target, "sections.json")));
    const top = (root.children || []).filter((n) => n.visible !== false && n.absoluteBoundingBox);
    const ordered = top.filter(n => !decorationOwner(n, top)).sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y || a.absoluteBoundingBox.x - b.absoluteBoundingBox.x)
      .map((n) => names[n.id]).filter((n) => n && fs.existsSync(path.join(target, "sections", n, "bricks-tree.json")));
    if (ordered.length) {
      const merge = spawnSync(process.execPath, ["scripts/merge_sections.js", target, ...ordered], { encoding: "utf8" });
      fs.writeFileSync(path.join(target, "merge.log"), (merge.stdout || "") + (merge.stderr || ""));
      if (merge.status) report.failures.push({ dir: target, stage: "merge", error: merge.stderr });
      else {
        try {
          const mergedDir = path.join(target, "merged"), tree = JSON.parse(fs.readFileSync(path.join(mergedDir, "bricks-tree.json")));
          const checked = validateBuild(tree, mergedDir);
          fs.writeFileSync(path.join(mergedDir, "validation-report.json"), JSON.stringify(checked, null, 2));
          if (checked.errors.length) report.failures.push({ dir: target, stage: "merged validation", errors: checked.errors });
        } catch (e) { report.failures.push({ dir: target, stage: "merged validation", error: e.message }); }
      }
    }
  }
}
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`Total: ${report.compiled} valid compilations, ${report.failures.length} failures. Report: ${path.join(out, "report.json")}`);
process.exitCode = report.failures.length ? 1 : 0;
