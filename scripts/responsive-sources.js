/** Explicit Figma responsive references override inferred values, without visual comparison. */
import fs from "node:fs";
import path from "node:path";
import { BRICKS_BREAKPOINTS } from "./breakpoints.js";
import { reconcileFigmaProperties } from "./figma-preservation.js";

export function applyResponsiveSources(input, mapping, { baseDir = ".", breakpointKeys = BRICKS_BREAKPOINTS.keys, load = file => JSON.parse(fs.readFileSync(file, "utf8")) } = {}) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Responsive frame map must be a breakpoint object.");
  const doc = structuredClone(input), report = [];
  const normalized = new Map();
  (function walk(n) { if (n.figmaNodeId) { const entries = normalized.get(n.figmaNodeId) || []; entries.push(n); normalized.set(n.figmaNodeId, entries); } for (const child of n.children || []) walk(child); })(doc);
  for (const [bp, reference] of Object.entries(mapping)) {
    if (!breakpointKeys.includes(bp)) throw new Error(`Responsive source uses unconfigured Bricks breakpoint ${bp}`);
    if (!reference || typeof reference.source !== "string" || !reference.nodes || typeof reference.nodes !== "object" || Array.isArray(reference.nodes)) throw new Error(`Responsive source ${bp} requires source file and nodes{desktopFigmaId:responsiveFigmaId}.`);
    const raw = load(path.resolve(baseDir, reference.source));
    const root = raw.document || raw;
    const nodes = new Map();
    (function walk(n) { if (n.id) nodes.set(n.id, n); for (const c of n.children || []) walk(c); })(root);
    let applied = 0;
    for (const [desktopId, mobileId] of Object.entries(reference.nodes)) {
      const targets = normalized.get(desktopId);
      if (!targets) continue; // The mapping may cover other compiled sections.
      if (targets.length !== 1) throw new Error(`Ambiguous responsive mapping for Figma node ${desktopId}; match one editable element.`);
      const source = nodes.get(mobileId);
      if (!source || source.visible === false) throw new Error(`Responsive source node ${mobileId} missing or hidden for ${desktopId}.`);
      const target = targets[0], measured = { type: target.type, id: `${target.id}-responsive`, figmaNodeId: mobileId, children: [] };
      reconcileFigmaProperties({ type: "page", children: [measured] }, root);
      const responsive = target.responsive ||= {}, patch = responsive[bp] ||= {};
      for (const key of ["layout", "size", "typography", "border", "background", "boxShadow"]) if (measured[key]) patch[key] = { ...(patch[key] || {}), ...measured[key] };
      applied++;
    }
    report.push(`${bp}: ${applied} explicit Figma node reference(s) applied; measured source takes priority over inference.`);
  }
  return { doc, report };
}

export function applyResponsiveSourceFile(doc, frameDir) {
  for (const dir of [frameDir, path.join(frameDir, ".."), path.join(frameDir, "..", "..")]) {
    const file = path.join(dir, "responsive-frame-map.json");
    if (fs.existsSync(file)) return applyResponsiveSources(doc, JSON.parse(fs.readFileSync(file, "utf8")), { baseDir: dir });
  }
  return { doc, report: [] };
}
