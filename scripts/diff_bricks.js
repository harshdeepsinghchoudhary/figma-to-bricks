/**
 * Compare a known-good hand-built Bricks export against compiler output.
 *
 * Usage:
 *   node scripts/diff_bricks.js <reference.json> <generated.json> <refRootId>[,<refRootId>...]
 *
 * reference: Bricks template export ({content:[...]}) - e.g. homepage.json
 * generated: bricks-tree.json (array) or a Bricks export ({content:[...]})
 * refRootId: the section id(s) in the reference that correspond to the generated sections, in order.
 *
 * Leaf elements (heading/text/button/image/icon) are paired by type + text (images/icons by order),
 * then every settings key is classified: MATCH, DIFF, MISSING (reference has it, generated doesn't), EXTRA.
 * Responsive variants (keys with ":" like _padding:tablet_portrait) and pseudo-element keys (::after) are
 * reported as their own groups since the compiler has no breakpoint concept yet.
 */
import fs from "node:fs";

const [refPath, genPath, rootsArg] = process.argv.slice(2);
if (!refPath || !genPath || !rootsArg) { console.error("Usage: node scripts/diff_bricks.js <reference.json> <generated.json> <refRootId,...>"); process.exit(1); }
const load = (p) => { const j = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(j) ? j : j.content; };
const ref = load(refPath), gen = load(genPath);
const refBy = new Map(ref.map((e) => [e.id, e])), genBy = new Map(gen.map((e) => [e.id, e]));

const LEAF = new Set(["heading", "text", "text-basic", "button", "image", "icon"]);
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

function collect(by, rootId, out = { leaves: [], containers: [] }, depth = 0) {
  const e = by.get(rootId); if (!e) return out;
  (LEAF.has(e.name) ? out.leaves : out.containers).push({ e, depth });
  for (const c of e.children || []) collect(by, c, out, depth + 1);
  return out;
}
function outline(by, id, ind = 0, lines = []) {
  const e = by.get(id); if (!e) return lines;
  const s = e.settings || {};
  const hint = strip(s.text).slice(0, 28);
  lines.push(`${" ".repeat(ind)}${e.name}${hint ? ` "${hint}"` : ""}`);
  for (const c of e.children || []) outline(by, c, ind + 2, lines);
  return lines;
}
// flatten settings to path -> normalised scalar
function flat(o, p = "", out = {}) {
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
  else out[p] = o;
  return out;
}
const norm = (v) => {
  if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?(px)?$/.test(t)) return String(parseFloat(t));
    return strip(t).toLowerCase();
  }
  return String(v);
};
const SKIP = /(\.id$|\.filename$|\.url$|\.full$|\.size$|\.library$)/; // asset plumbing, not design
const isResp = (k) => /:(tablet|mobile)/.test(k.split(".")[0]);
const isPseudo = (k) => /::/.test(k.split(".")[0]);

const refRoots = rootsArg.split(","); const genRoots = gen.filter((e) => e.parent === 0 || e.parent === "0").map((e) => e.id);
if (refRoots.length !== genRoots.length) console.warn(`NOTE: ${refRoots.length} reference root(s) vs ${genRoots.length} generated root(s)`);

const tot = { match: 0, diff: 0, missing: 0, extra: 0, respMissing: 0, pseudoMissing: 0 };
const missingByKey = new Map(), diffs = [];

refRoots.forEach((rid, i) => {
  const gid = genRoots[i]; if (!gid) return;
  const r = collect(refBy, rid), g = collect(genBy, gid);
  console.log(`\n================ SECTION ${i + 1}: reference ${rid}  vs  generated ${gid}`);
  console.log("--- reference structure\n" + outline(refBy, rid).join("\n"));
  console.log("--- generated structure\n" + outline(genBy, gid).join("\n"));

  const used = new Set();
  const pair = (rl) => {
    const rt = strip(rl.e.settings?.text);
    const cands = g.leaves.filter((x) => !used.has(x.e.id) && x.e.name === rl.e.name);
    if (rt) return cands.find((x) => strip(x.e.settings?.text).slice(0, 60) === rt.slice(0, 60));
    return cands[0];
  };
  for (const rl of r.leaves) {
    const gl = pair(rl);
    const label = `${rl.e.name} ${strip(rl.e.settings?.text).slice(0, 30) || "(no text)"}`;
    if (!gl) { console.log(`\n[NOT GENERATED] ${label}`); continue; }
    used.add(gl.e.id);
    const a = flat(rl.e.settings), b = flat(gl.e.settings);
    const rows = [];
    for (const k of Object.keys(a)) {
      if (SKIP.test(k) || k === "text") continue;
      if (!(k in b)) {
        const bucket = isResp(k) ? "respMissing" : isPseudo(k) ? "pseudoMissing" : "missing";
        tot[bucket]++; rows.push(`  ${bucket === "missing" ? "MISSING" : bucket.toUpperCase()}  ${k} = ${JSON.stringify(a[k])}`);
        const kk = k.replace(/^(_[A-Za-z-]+).*/, "$1"); missingByKey.set(kk, (missingByKey.get(kk) || 0) + 1);
      } else if (norm(a[k]) === norm(b[k])) tot.match++;
      else { tot.diff++; rows.push(`  DIFF     ${k}: reference ${JSON.stringify(a[k])}  generated ${JSON.stringify(b[k])}`); diffs.push(k); }
    }
    for (const k of Object.keys(b)) if (!(k in a) && !SKIP.test(k) && k !== "text") { tot.extra++; rows.push(`  EXTRA    ${k} = ${JSON.stringify(b[k])}`); }
    console.log(`\n[PAIRED] ${label}${rows.length ? "" : "  - identical"}\n${rows.join("\n")}`);
  }
  for (const gl of g.leaves) if (!used.has(gl.e.id)) console.log(`\n[EXTRA ELEMENT in generated] ${gl.e.name} ${strip(gl.e.settings?.text).slice(0, 30)}`);

  // container-level settings, aggregated (hand-built containers differ in structure, so just list them)
  const keys = (list) => new Set(list.flatMap((x) => Object.keys(x.e.settings || {}).filter((k) => !isResp(k) && !isPseudo(k))));
  const rk = keys(r.containers), gk = keys(g.containers);
  console.log(`\n--- container-level setting keys\n  reference only : ${[...rk].filter((k) => !gk.has(k)).join(", ") || "-"}\n  generated only : ${[...gk].filter((k) => !rk.has(k)).join(", ") || "-"}`);
  const respC = r.containers.flatMap((x) => Object.keys(x.e.settings || {}).filter(isResp));
  console.log(`  reference responsive overrides on containers: ${respC.length}${respC.length ? " (" + [...new Set(respC)].join(", ") + ")" : ""}`);
});

const considered = tot.match + tot.diff + tot.missing;
console.log(`\n================ SUMMARY (leaf elements, desktop settings only)`);
console.log(`  match   ${tot.match}\n  differ  ${tot.diff}\n  missing ${tot.missing}\n  extra   ${tot.extra}`);
console.log(`  desktop reproduction: ${considered ? Math.round((tot.match / considered) * 100) : 0}% of reference keys match exactly`);
console.log(`  responsive-variant keys not generated: ${tot.respMissing}\n  pseudo-element keys not generated: ${tot.pseudoMissing}`);
console.log(`  most-missing setting groups: ${[...missingByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}(${n})`).join(", ") || "-"}`);
