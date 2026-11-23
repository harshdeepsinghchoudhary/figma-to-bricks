import { validateBricks } from "./bricks-validator.js";
import { isDeepStrictEqual } from "node:util";
import { validateNativeComponents } from "./native-components.js";

// Resolve the entire proposal set before applying anything: order must not decide
// which of two contradictory model answers wins.
export function filterVisualPatches(tree, patches) {
  const byId = new Map(tree.map(e => [e.id, e]));
  const proposals = new Map(), rejected = [], accepted = [];
  for (const p of patches) {
    const fields = p.op === "settings" ? Object.entries(p.set || {}) : [[p.op, p]];
    for (const [key, value] of fields) {
      const token = `${p.id}:${key}`, entries = proposals.get(token) || [];
      entries.push({ p, key, value }); proposals.set(token, entries);
    }
  }
  for (const entries of proposals.values()) {
    const { p, key, value } = entries[0], e = byId.get(p.id);
    if (entries.some(v => !isDeepStrictEqual(v.value, value))) {
      rejected.push({ patch: p, field: key, reason: "Conflicting proposals for the same field." }); continue;
    }
    const unchanged = p.op === "settings" ? (value === null ? !Object.hasOwn(e?.settings || {}, key) : isDeepStrictEqual(e?.settings?.[key], value))
      : p.op === "reorder" ? isDeepStrictEqual(e?.children, p.children)
      : p.op === "move" && e?.parent === p.parent && byId.get(p.parent)?.children.indexOf(p.id) === p.index;
    if (unchanged) { rejected.push({ patch: p, field: key, reason: "No change to the existing tree." }); continue; }
    accepted.push(p.op === "settings" ? { ...p, set: { [key]: value } } : p);
  }
  return { patches: accepted, rejected };
}

const allowed = new Set(["_display", "_direction", "_flexDirection", "_alignItems", "_alignItemsGrid", "_justifyContent", "_flexWrap", "_gridTemplateColumns", "_rowGap", "_columnGap", "_gap", "iconGap", "_gridGap", "_padding", "_margin", "_width", "_widthMax", "_widthMin", "_height", "_heightMin", "_heightMax", "_position", "_top", "_right", "_bottom", "_left", "_overflow", "_zIndex", "_alignSelf", "_flexGrow", "_flexShrink", "_flexBasis", "_background", "_border", "_typography", "_boxShadow", "_objectFit", "image"]);

export function visualPatchSettings() { return [...allowed]; }

export function validateReview(review, ids) {
  if (!review || !Array.isArray(review.issues) || !Array.isArray(review.patches)) throw new Error("Vision report must contain issues[] and patches[].");
  if (review.patches.length > 30 || review.issues.length > 50) throw new Error("Vision report exceeds the bounded correction budget.");
  for (const issue of review.issues) {
    if (!["high", "medium", "low"].includes(issue.severity) || typeof issue.description !== "string") throw new Error("Invalid visual issue.");
    if (issue.elementId && !ids.has(issue.elementId)) throw new Error(`Unknown issue element ${issue.elementId}`);
  }
  for (const patch of review.patches) if (!ids.has(patch.id)) throw new Error(`Unknown patch element ${patch.id}`);
  return review;
}

export function applyVisualPatches(tree, patches, validAssetUrls = []) {
  const doc = structuredClone(tree), byId = new Map(doc.map((e) => [e.id, e]));
  const urls = new Set(validAssetUrls);
  function checkValue(value, key = "") {
    if (typeof value === "string" && /[{};]|javascript:|url\s*\(/i.test(value)) throw new Error(`Unsafe visual setting value for ${key}`);
    if (key === "url" || key === "full") { if (typeof value !== "string" || !urls.has(value)) throw new Error("Visual patch references an unavailable asset."); }
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(k)) throw new Error("Invalid visual setting property.");
      checkValue(v, k);
    }
  }
  for (const patch of patches) {
    const e = byId.get(patch.id);
    if (!e) throw new Error(`Unknown element ${patch.id}`);
    if (patch.op === "settings") {
      if (!patch.set || typeof patch.set !== "object" || Array.isArray(patch.set)) throw new Error("settings patch needs set{}.");
      e.settings ||= {};
      for (const [key, value] of Object.entries(patch.set)) {
        const match = key.match(/^(_[^:]+|image|iconGap)(?::(tablet_portrait|mobile_landscape|mobile_portrait))?(?:::(before|after))?$/);
        if (!match || !allowed.has(match[1])) throw new Error(`Visual patch cannot set ${key}`);
        if (["heading", "text", "text-basic", "image", "icon"].includes(e.name) && ["_direction", "_flexDirection", "_rowGap", "_columnGap", "_gap"].includes(match[1])) throw new Error(`Flex container setting ${key} is invalid on ${e.name}.`);
        if (match[1] === "image" && e.name !== "image") throw new Error("Only image elements can receive settings.image.");
        if (e.name === "button" && ["_direction", "_rowGap", "_columnGap"].includes(match[1])) throw new Error("Button patches must use _flexDirection, _gap and iconGap.");
        checkValue(value);
        if (value === null) delete e.settings[key]; else e.settings[key] = value;
      }
    } else if (patch.op === "reorder") {
      if (!Array.isArray(patch.children) || patch.children.length !== e.children.length || new Set(patch.children).size !== e.children.length || patch.children.some((id) => !e.children.includes(id))) throw new Error("reorder must keep exactly the existing children.");
      e.children = patch.children;
    } else if (patch.op === "move") {
      const parent = byId.get(patch.parent);
      if (!parent || !["div", "block", "container", "section"].includes(parent.name) || !Number.isInteger(patch.index) || patch.index < 0 || patch.index > parent.children.length) throw new Error("Invalid visual move target.");
      if (!e.parent) throw new Error("Visual correction cannot move a root section.");
      const old = byId.get(e.parent);
      old.children = old.children.filter((id) => id !== e.id);
      parent.children.splice(patch.index, 0, e.id); e.parent = parent.id;
    } else throw new Error(`Unknown visual patch operation ${patch.op}`);
  }
  const checked = validateBricks(doc, { strict: true });
  checked.errors.push(...validateNativeComponents(doc).errors);
  if (checked.errors.length) throw new Error(`Visual correction invalid: ${checked.errors.join("; ")}`);
  return doc;
}
