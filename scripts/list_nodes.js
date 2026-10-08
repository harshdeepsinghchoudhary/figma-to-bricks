/**
 * List the node tree of an extracted frame so you can pick --nodes=... ids for stage 2.
 *
 * Usage:  node scripts/list_nodes.js output/<frame-name> [depth]     (default depth 2)
 *
 * Columns: id | type | name | x,y offset inside the frame | width x height | child count
 * Sorted top-to-bottom so the page sections read in order.
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const maxDepth = Number(process.argv[3] || 2);
if (!dir) { console.error("Usage: node scripts/list_nodes.js output/<frame-name> [depth]"); process.exit(1); }
const root = JSON.parse(fs.readFileSync(path.join(dir, "figma-node.json"), "utf-8"));
const ox = root.absoluteBoundingBox?.x ?? 0, oy = root.absoluteBoundingBox?.y ?? 0;

function row(n, depth) {
  const b = n.absoluteBoundingBox;
  const pos = b ? `${Math.round(b.x - ox)},${Math.round(b.y - oy)}` : "-";
  const size = b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "-";
  const name = String(n.name).replace(/\s+/g, " ").slice(0, 44);
  console.log(`${"  ".repeat(depth)}${n.id}  ${n.type}  "${name}"  @${pos}  ${size}  (${(n.children || []).length})`);
}
function walk(n, depth) {
  row(n, depth);
  if (depth >= maxDepth) return;
  const kids = [...(n.children || [])].sort((a, b) => (a.absoluteBoundingBox?.y ?? 0) - (b.absoluteBoundingBox?.y ?? 0));
  for (const c of kids) walk(c, depth + 1);
}
walk(root, 0);