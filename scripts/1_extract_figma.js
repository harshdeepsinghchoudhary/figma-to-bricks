/**
 * Stage 1: Figma extraction (v3: rate-limit safe, resumable, deduplicated)
 *
 * Usage:
 *   node scripts/1_extract_figma.js "<figma-url-with-node-id>" [--dry-run] [--no-svg]
 *
 *   --dry-run  make ZERO Figma API calls if figma-node.json is already cached; only
 *              analyse it and write candidates.json (counts, duplicates, samples).
 *   --no-svg   export only photo/image fills (PNG), skip icons.
 *
 * Writes to output/<frame-name>/:
 *   figma-node.json, screenshot.png, candidates.json, asset-manifest.json, assets/*
 *
 * Re-running is safe: cached figma-node.json / screenshot.png / asset files are reused,
 * so a re-run makes as few Figma API calls as possible.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import fetch from "node-fetch";
import { findPanels } from "./decoration-detect.js";

const args = process.argv.slice(2);
const figmaUrl = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const NO_SVG = args.includes("--no-svg");
const REFRESH = args.includes("--refresh");

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
if (!FIGMA_TOKEN && !DRY_RUN) {
  console.error("Missing FIGMA_TOKEN in .env");
  process.exit(1);
}
if (!figmaUrl) {
  console.error('Usage: node scripts/1_extract_figma.js "<figma-url-with-node-id>" [--dry-run] [--no-svg]');
  process.exit(1);
}

function parseFigmaUrl(url) {
  const fileKeyMatch = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  const nodeIdMatch = url.match(/node-id=([^&]+)/);
  if (!fileKeyMatch || !nodeIdMatch) {
    throw new Error("Could not parse file key / node-id from URL. Expected a URL with ?node-id=");
  }
  return {
    fileKey: fileKeyMatch[1],
    nodeId: decodeURIComponent(nodeIdMatch[1]).replace(/-/g, ":"),
  };
}

class RateLimitError extends Error {}

// NOTE: no retry on 429. Retrying a rate-limited Figma request can extend the lockout.
async function figmaGet(endpoint) {
  const res = await fetch(`https://api.figma.com/v1${endpoint}`, {
    headers: { "X-Figma-Token": FIGMA_TOKEN },
  });
  if (res.status === 429) {
    const h = (k) => res.headers.get(k) ?? "(none)";
    const secs = Number(res.headers.get("retry-after"));
    throw new RateLimitError(
      [
        "Figma rate limit (429). Stopping on purpose - do NOT keep re-running.",
        `  Retry-After:              ${h("retry-after")}` +
          (secs ? `  (~${(secs / 3600).toFixed(1)} hours)` : ""),
        `  X-Figma-Plan-Tier:        ${h("x-figma-plan-tier")}`,
        `  X-Figma-Rate-Limit-Type:  ${h("x-figma-rate-limit-type")}`,
        `  X-Figma-Upgrade-Link:     ${h("x-figma-upgrade-link")}`,
        "Everything downloaded so far is saved; re-running later resumes from there.",
      ].join("\n")
    );
  }
  if (!res.ok) {
    throw new Error(`Figma API ${endpoint.slice(0, 80)}... -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// ---------- asset detection ----------
// The HIGHEST graphic ancestor is exported as ONE svg, so a logo or illustration built
// from 40 vector pieces is 1 asset, not 40. The actual "is this a graphic" rule lives in
// graphic-detect.js, shared with stage 2 (which needs the same answer to know what raw
// vector data it can safely strip out of the LLM prompt).
import { hasImageFill, isGraphicNode } from "./graphic-detect.js";

function collectAssetNodes(node, acc = [], parent = null) {
  if (node.visible === false) return acc;

  if (hasImageFill(node)) acc.push({ id: node.id, name: node.name, kind: "image" });

  if (!hasImageFill(node) && node.absoluteBoundingBox && node.type !== "TEXT") {
    const { isGraphic, vectors } = isGraphicNode(node);
    if (isGraphic) {
      const box = node.absoluteBoundingBox;
      acc.push({
        id: node.id,
        name: node.name,
        kind: "svg",
        componentId: node.componentId || null,
        sig: visualSig(node),
        w: Math.round(box.width),
        h: Math.round(box.height),
        nodeType: node.type,
        vectorCount: vectors,
        parent: parent ? `${parent.name} (${parent.type})` : null,
      });
      return acc; // never descend into a graphic
    }
  }
  for (const child of node.children || []) collectAssetNodes(child, acc, node);
  return acc;
}

// Icons that are the same component (or same name+size) AND look the same are exported ONCE.
// "Frame 30x30" can be a green check or a red X, so the key includes a signature of the colours/shapes inside.
function visualSig(node) {
  const hex = (c) => (c ? [c.r, c.g, c.b, c.a ?? 1].map((v) => Math.round(v * 255)).join(",") : "");
  const paints = (arr) => (arr || []).filter((p) => p.visible !== false).map((p) => `${p.type}:${hex(p.color)}:${(p.gradientStops || []).map((s) => hex(s.color) + "@" + Math.round(s.position * 100)).join(";")}`).join("|");
  const parts = [];
  let hasPathGeometry = false;
  (function walk(n) {
    if (n.visible === false) return;
    const b = n.absoluteBoundingBox;
    parts.push(`${n.type}[${paints(n.fills)}][${paints(n.strokes)}]${n.strokeWeight || 0}/${n.cornerRadius || 0}/${b ? Math.round(b.width) + "x" + Math.round(b.height) : ""}`);
    const geometry = n.vectorPaths || n.fillGeometry || n.vectorNetwork;
    if (geometry) { hasPathGeometry = true; parts.push(JSON.stringify(geometry)); }
    parts.push(JSON.stringify({ transform: n.relativeTransform, opacity: n.opacity, effects: n.effects, strokeGeometry: n.strokeGeometry, radii: n.rectangleCornerRadii }));
    for (const c of n.children || []) walk(c);
  })(node);
  // Equal names/colours/boxes are not proof of equal paths (e.g. a check and an X).
  // Without path geometry, only known component instances may share an export.
  if (!node.componentId && !hasPathGeometry) parts.push(node.id);
  let h = 0;
  const str = parts.join("~");
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function dedupeSvg(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    const key = n.componentId ? `c:${n.componentId}|${n.sig}` : `n:${n.name}|${n.w}x${n.h}|${n.sig}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, rep: members[0], members }));
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "frame";
}
function findCachedDir(fileKey, nodeId) {
  if (!fs.existsSync("output")) return null;
  for (const d of fs.readdirSync("output")) {
    const p = path.join("output", d, "figma-node.json");
    if (!fs.existsSync(p)) continue;
    try {
      if (JSON.parse(fs.readFileSync(p, "utf8")).id !== nodeId) continue;
      const dir = path.join("output", d);
      const identityPath = path.join(dir, "extract-source.json");
      const identity = fs.existsSync(identityPath) ? JSON.parse(fs.readFileSync(identityPath, "utf8")) : null;
      const sourcePath = path.join(dir, "source.json");
      const legacy = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, "utf8")) : null;
      if (identity?.fileKey === fileKey && identity.nodeId === nodeId) return dir;
      if (!identity && legacy?.figmaUrl && parseFigmaUrl(legacy.figmaUrl).fileKey === fileKey) return dir;
    } catch {}
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, file) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) return false; // real HTTP error from the CDN, not worth retrying
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) {
      // transient network errors (socket hang up, ECONNRESET, timeouts) - retry with backoff
      if (attempt === 4) {
        console.warn(`  download failed after ${attempt} attempts: ${String(e.message).slice(0, 100)}`);
        return false;
      }
      await sleep(1000 * attempt);
    }
  }
  return false;
}

async function main() {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  console.log(`File: ${fileKey}  Node: ${nodeId}${DRY_RUN ? "   [DRY RUN]" : ""}`);

  // 1) node tree (cached -> no API call)
  let outDir = findCachedDir(fileKey, nodeId);
  let rootNode;
  if (outDir && (!REFRESH || DRY_RUN)) {
    console.log(`Using cached ${outDir}/figma-node.json (no API call)`);
    rootNode = JSON.parse(fs.readFileSync(path.join(outDir, "figma-node.json"), "utf8"));
  } else {
    if (DRY_RUN) throw new Error("--dry-run needs an existing figma-node.json in output/<frame>/");
    console.log("Fetching node tree...");
    const nodeData = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`);
    const nodeResult = nodeData.nodes[nodeId];
    if (!nodeResult) throw new Error(`Node ${nodeId} not found in response`);
    rootNode = nodeResult.document;
    const suffix = createHash("sha256").update(`${fileKey}:${nodeId}`).digest("hex").slice(0, 8);
    outDir ||= path.join("output", `${slugify(rootNode.name)}-${suffix}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "figma-node.json"), JSON.stringify(rootNode, null, 2));
    console.log(`Wrote ${outDir}/figma-node.json`);
  }
  fs.writeFileSync(path.join(outDir, "extract-source.json"), JSON.stringify({ fileKey, nodeId, figmaUrl }, null, 2));
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // 2) candidates
  const assetNodes = collectAssetNodes(rootNode);
  const pngNodes = assetNodes.filter((n) => n.kind === "image");
  const svgAll = NO_SVG ? [] : assetNodes.filter((n) => n.kind === "svg");
  const svgGroups = dedupeSvg(svgAll);
  console.log(
    `Candidates: ${pngNodes.length} image fill(s), ${svgAll.length} icon node(s) -> ${svgGroups.length} UNIQUE icon(s) after dedupe`
  );

  // decoration layers (pattern/vector groups behind a card or section) are exported as ONE svg each, used as ::before/::after backgrounds
  if (!NO_SVG) {
    for (const panel of findPanels(rootNode)) for (const l of panel.layers) {
      if (svgGroups.some((g) => g.members.some((m) => m.id === l.id))) continue;
      svgGroups.push({ rep: { id: l.id, name: l.name, w: l.w, h: l.h, nodeType: l.type, vectorCount: 0, parent: "decoration layer" }, members: [{ id: l.id, name: l.name }] });
      console.log(`Decoration layer ${l.id} "${l.name}" ${l.w}x${l.h} (panel ${panel.id}) -> svg export`);
    }
  }

  const bySize = svgGroups
    .map((g) => ({ name: g.rep.name, size: `${g.rep.w}x${g.rep.h}`, copies: g.members.length, type: g.rep.nodeType, vectors: g.rep.vectorCount, parent: g.rep.parent }))
    .sort((a, b) => b.copies - a.copies);
  fs.writeFileSync(
    path.join(outDir, "candidates.json"),
    JSON.stringify({ images: pngNodes, uniqueIcons: bySize }, null, 2)
  );
  console.log(`Wrote ${outDir}/candidates.json`);
  // Planned manifest: every node id -> the file it WILL be exported to. Lets stage 2 run
  // before the asset files exist. Written to a separate file so it never fakes a finished export.
  const plannedFile = (fmt, rep) => `assets/${slugify(rep.name)}-${rep.id.replace(/[:;]/g, "_")}.${fmt}`;
  const planned = [
    ...pngNodes.map((n) => ({ nodeId: n.id, name: n.name, type: "image", file: plannedFile("png", n) })),
    ...svgGroups.flatMap((g) =>
      g.members.map((m) => ({ nodeId: m.id, name: m.name, type: "svg", file: plannedFile("svg", g.rep) }))
    ),
  ];
  fs.writeFileSync(path.join(outDir, "asset-manifest.planned.json"), JSON.stringify(planned, null, 2));
  console.log(`Wrote ${outDir}/asset-manifest.planned.json (${planned.length} entries)`);

  if (DRY_RUN) {
    console.log("\nMost repeated:");
    bySize.slice(0, 8).forEach((x) => console.log(`  x${x.copies}  ${x.name}  ${x.size}  ${x.type}  (${x.vectors} vectors)  in: ${x.parent}`));
    console.log("\nLargest:");
    [...bySize].sort((a, b) => parseInt(b.size) - parseInt(a.size)).slice(0, 8).forEach((x) => console.log(`  ${x.name}  ${x.size}  ${x.type}  (${x.vectors} vectors)  in: ${x.parent}`));
    console.log("\nDry run done. No API calls were made.");
    return;
  }

  // 3) screenshot (skip if cached)
  const shot = path.join(outDir, "screenshot.png");
  if (fs.existsSync(shot) && !REFRESH) {
    console.log("screenshot.png already exists, skipping");
  } else {
    console.log("Requesting frame screenshot...");
    const s = await figmaGet(`/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&scale=2&format=png`);
    if (s.images[nodeId] && (await download(s.images[nodeId], shot))) console.log(`Wrote ${shot}`);
    else throw new Error("Frame screenshot download failed; extraction is incomplete.");
  }

  // 4) assets, resumable, manifest saved after every batch
  const manifestPath = path.join(outDir, "asset-manifest.json");
  // Entries from an earlier run are kept only if they still match the current grouping: before icons were told apart by colour,
  // a red X could be mapped onto the green check's file. Those stale entries are dropped so the right icon is exported.
  const plannedFileOf = new Map(planned.map((p) => [p.nodeId, p.file]));
  const manifest = (!REFRESH && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : []).filter(
    (m) => fs.existsSync(path.join(outDir, m.file)) && (!plannedFileOf.has(m.nodeId) || plannedFileOf.get(m.nodeId) === m.file)
  );
  const dropped = (fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).length : 0) - manifest.length;
  if (dropped > 0) console.log(`Dropped ${dropped} stale manifest entr${dropped === 1 ? "y" : "ies"} (icon grouping changed) - they will be re-exported.`);
  const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const have = new Set(manifest.map((m) => m.nodeId));

  async function exportAndSave(items, format) {
    // New instances of a cached graphic still need their node -> file mapping.
    for (const it of items) {
      const cached = manifest.find((m) => m.nodeId === it.rep.id);
      if (!cached) continue;
      for (const member of it.members) if (!have.has(member.id)) {
        manifest.push({ ...cached, nodeId: member.id, name: member.name }); have.add(member.id);
      }
    }
    saveManifest();
    // items: [{ rep, members }]; only the rep is exported, every member maps to that file
    const todo = items.filter((it) => !have.has(it.rep.id));
    if (!todo.length) return console.log(`${format}: nothing left to export`);
    const BATCH = 40;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      console.log(`Exporting ${format}: ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
      const ids = batch.map((b) => b.rep.id).join(",");
      const data = await figmaGet(
        `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}${format === "png" ? "&scale=2" : ""}`
      );
      for (const it of batch) {
        const url = data.images?.[it.rep.id];
        if (!url) continue;
        const filename = `${slugify(it.rep.name)}-${it.rep.id.replace(/[:;]/g, "_")}.${format}`;
        if (!(await download(url, path.join(assetsDir, filename)))) continue;
        for (const m of it.members) {
          manifest.push({ nodeId: m.id, name: m.name, type: format === "png" ? "image" : "svg", file: `assets/${filename}` });
          have.add(m.id);
        }
      }
      saveManifest();
      await sleep(1500); // gentle pacing between calls
    }
  }

  await exportAndSave(pngNodes.map((n) => ({ rep: n, members: [n] })), "png");
  await exportAndSave(svgGroups, "svg");

  saveManifest();
  const missing = planned.filter((p) => !have.has(p.nodeId));
  if (missing.length) throw new Error(`${missing.length} assets were not exported. Re-run extraction to resume; pipeline stopped before normalization.`);
  console.log(`Manifest has ${manifest.length} node->file mapping(s). Done. Output in ${outDir}/`);
}

main().catch((err) => {
  console.error(err instanceof RateLimitError ? "\n" + err.message : err);
  process.exit(1);
});
