import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema/runtime/site-context.json");
export function breakpointConfig(context = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null) {
  const config = context?.breakpoints;
  const points = config?.breakpoints || [
    { key: "desktop", width: 1279, base: true },
    { key: "tablet_portrait", width: 991 },
    { key: "mobile_landscape", width: 767 },
    { key: "mobile_portrait", width: 478 }
  ];
  if (!Array.isArray(points) || !points.length || points.some(p => !/^[a-z][a-z0-9_]*$/.test(p.key) || !Number.isFinite(p.width) || p.width <= 0)) throw new Error("Invalid saved Bricks breakpoint configuration; run schema:sync.");
  const variants = points.filter(p => !p.base && p.key !== config?.baseKey).sort((a, b) => b.width - a.width);
  if (!variants.length) throw new Error("Bricks has no responsive breakpoints configured.");
  return { isMobileFirst: config?.isMobileFirst || false, baseKey: config?.baseKey || "desktop", variants, keys: variants.map(p => p.key), tablet: variants.find(p => p.width >= 800)?.key || variants[0].key, mobile: variants.find(p => p.width < 800)?.key || variants.at(-1).key };
}

export const BRICKS_BREAKPOINTS = breakpointConfig();
