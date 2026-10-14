// Copy cached compiler inputs into an isolated workspace; no APIs or screenshots.
import fs from "node:fs";
import path from "node:path";
const source = path.resolve(process.argv[2] || "output/casinofx-homepage");
const target = path.resolve(process.argv[3] || path.join(".review-work", `staging-${path.basename(source)}-${Date.now()}`));
const workspace = path.resolve(".");
if (!target.startsWith(workspace + path.sep) || target === source) throw new Error("Use a new staging build folder inside this workspace.");
if (fs.existsSync(target)) throw new Error("Staging build destination already exists; choose a new folder to preserve previous outputs.");
fs.mkdirSync(target, { recursive: true });
for (const file of ["figma-node.json", "sections.json", "source.json", "screenshot.png", "figma-metadata.json"]) if (fs.existsSync(path.join(source, file))) fs.copyFileSync(path.join(source, file), path.join(target, file));
const manifest = JSON.parse(fs.readFileSync(path.join(source, "asset-manifest.json"), "utf8"));
fs.writeFileSync(path.join(target, "asset-manifest.json"), JSON.stringify(manifest.map(a => ({ ...a, file: path.relative(target, path.resolve(source, a.file)).split(path.sep).join("/") })), null, 2));
const references = path.join(source, "responsive-frame-map.json");
if (fs.existsSync(references)) {
  const mapping = JSON.parse(fs.readFileSync(references, "utf8"));
  for (const reference of Object.values(mapping)) reference.source = path.resolve(source, reference.source);
  fs.writeFileSync(path.join(target, "responsive-frame-map.json"), JSON.stringify(mapping, null, 2));
}
const sections = path.join(source, "sections");
for (const name of fs.readdirSync(sections)) {
  const section = path.join(sections, name); if (!fs.existsSync(path.join(section, "normalized.json"))) continue;
  const dir = path.join(target, "sections", name); fs.mkdirSync(dir, { recursive: true });
  for (const file of ["normalized.json", "normalized-source.json", "prompt-figma.json", "bricks-id-namespace.json"]) if (fs.existsSync(path.join(section, file))) fs.copyFileSync(path.join(section, file), path.join(dir, file));
}
console.log(target);
