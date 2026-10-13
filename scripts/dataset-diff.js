import { isDeepStrictEqual } from "node:util";
export function diffTrees(before, after) {
  const a = new Map(before.map((e) => [e.id, e])), b = new Map(after.map((e) => [e.id, e]));
  const diff = { added: [], removed: [], changed: [] };
  for (const [id, e] of b) {
    const previous = a.get(id);
    if (!previous) { diff.added.push(e); continue; }
    const settings = {};
    for (const key of new Set([...Object.keys(previous.settings || {}), ...Object.keys(e.settings || {})])) {
      if (!isDeepStrictEqual(previous.settings?.[key], e.settings?.[key])) settings[key] = { before: previous.settings?.[key] ?? null, after: e.settings?.[key] ?? null };
    }
    const changed = { id, name: e.name, settings };
    for (const key of ["parent", "children", "name", "themeStyles"]) if (!isDeepStrictEqual(previous[key], e[key])) changed[key === "name" ? "elementType" : key] = { before: previous[key] ?? null, after: e[key] ?? null };
    if (Object.keys(settings).length || Object.keys(changed).length > 3) diff.changed.push(changed);
  }
  for (const [id, e] of a) if (!b.has(id)) diff.removed.push(e);
  return diff;
}
