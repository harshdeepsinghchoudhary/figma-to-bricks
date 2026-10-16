/**
 * Stage 4 (MCP version): push a compiled bricks-tree.json into WordPress via Bricks abilities.
 * Separate from 4_inject.js - the old REST/postmeta route is untouched.
 *
 * Usage (from the project root, so .env is found):
 *   node --env-file=.env scripts/4_inject_mcp.js <tree.json | folder> [options]
 *
 *   node --env-file=.env scripts/4_inject_mcp.js output/jilislot-global/sections/hero
 *   node --env-file=.env scripts/4_inject_mcp.js output/jilislot-global/sections/hero --page 123
 *
 * Options:
 *   --page <id>      Write into this existing page. Default: create a NEW DRAFT page.
 *   --title "<t>"    Title for the new draft page (default: "MCP Test - <folder name>").
 *   --no-assets      Skip uploading images/icons (keeps local ../assets paths).
 *   --assets-only    Upload/verify assets and stop without creating or saving a page.
 *   --render-only    Upload nothing, save nothing: just render-check the tree. Needs --page.
 *   --fix-keys       If Bricks rejects a setting key and suggests a replacement ("did you mean"),
 *                    rename it in memory and retry. Writes the patched tree next to the report
 *                    and prints every rename, so the real fix can go into the compiler.
 *
 * Flow: (1) upload local assets, (2) get/create the draft page, (3) render-elements check
 * (nothing saved), (4) set-page-elements (Bricks takes a revision first; its id is printed),
 * (5) regenerate CSS files if that ability is enabled.
 *
 * Env (same .env as test-mcp.mjs): WP_API_URL, WP_API_USERNAME, WP_API_PASSWORD
 * Needs Node 18+. No dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { validateBricks } from "./bricks-validator.js";
import { validateBuild } from "./validate-build.js";
import { verifyCachedMedia } from "./media-cache.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const optNames = new Set(["--page", "--title", "--report-dir"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !optNames.has(argv[i - 1]));
const target = positional[0];
if (!target) {
  console.error("Usage: node --env-file=.env scripts/4_inject_mcp.js <tree.json | folder> [--page <id>] [--title \"...\"] [--no-assets] [--render-only]");
  process.exit(1);
}
const PAGE_ARG = opt("--page") ? Number(opt("--page")) : null;
if (opt("--page") && !Number.isInteger(PAGE_ARG)) {
  console.error("--page must be a numeric post ID.");
  process.exit(1);
}
const RENDER_ONLY = flag("--render-only");
const NO_ASSETS = flag("--no-assets");
const FIX_KEYS = flag("--fix-keys");
if (RENDER_ONLY && !PAGE_ARG) {
  console.error("--render-only needs --page <id> (rendering needs a post for context, and I won't create one in render-only mode).");
  process.exit(1);
}

// ---------- env (.env fallback if not started with --env-file) ----------
try {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const { WP_API_URL, WP_API_USERNAME, WP_API_PASSWORD } = process.env;
const missing = ["WP_API_URL", "WP_API_USERNAME", "WP_API_PASSWORD"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing in .env: " + missing.join(", "));
  process.exit(1);
}
const AUTH = "Basic " + Buffer.from(`${WP_API_USERNAME}:${WP_API_PASSWORD}`).toString("base64");
const SITE_BASE = WP_API_URL.split("/wp-json")[0];

// ---------- load tree ----------
const treePath = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, "bricks-tree.json") : target;
if (!fs.existsSync(treePath)) {
  console.error(`Tree not found: ${treePath}  (run stage 3 first)`);
  process.exit(1);
}
const treeDir = path.dirname(path.resolve(treePath));
const tree = JSON.parse(fs.readFileSync(treePath, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(tree) || !tree.length) {
  console.error("bricks-tree.json must be a non-empty array of Bricks elements (flat format).");
  process.exit(1);
}
const label = path.basename(path.dirname(path.resolve(treePath))) || "tree";
const validation = validateBricks(tree);
if (validation.errors.length) throw new Error(`Invalid Bricks tree: ${validation.errors.join("; ")}`);
const buildValidation = validateBuild(tree, treeDir);
if (buildValidation.errors.length) throw new Error(`Unsafe/unverified native build: ${buildValidation.errors.join("; ")}`);
const outDir = path.resolve(opt("--report-dir") || "output");
fs.mkdirSync(outDir, { recursive: true });

// ---------- MCP client ----------
let sessionId = null;
let nextId = 1;
async function rpc(method, params = {}, notify = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!notify) body.id = nextId++;
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: AUTH };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(WP_API_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method}: ${text.slice(0, 500)}`);
  if (notify || !text.trim()) return null;
  let payload = text.trim();
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    payload = payload.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() || "{}";
  }
  const json = JSON.parse(payload);
  if (json.error) throw new Error(`RPC error on ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
let execTool, abilityKey, paramsKey;
async function connect() {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "figma-bricks-inject-mcp", version: "0.1.0" },
  });
  await rpc("notifications/initialized", {}, true);
  const { tools } = await rpc("tools/list");
  execTool = tools.find((t) => t.name.toLowerCase().includes("execute"));
  if (!execTool) throw new Error("execute-ability tool not found on this MCP server.");
  const props = Object.keys(execTool.inputSchema?.properties || {});
  abilityKey = props.find((k) => /ability|name/i.test(k)) || "ability_name";
  paramsKey = props.find((k) => /param|input|arg/i.test(k)) || "parameters";
}
function unwrap(result) {
  let out = result?.structuredContent;
  if (!out) {
    const t = result?.content?.find((c) => c.type === "text")?.text;
    try { out = JSON.parse(t); } catch { out = t; }
  }
  return out;
}
async function ability(name, params = {}) {
  const r = await rpc("tools/call", { name: execTool.name, arguments: { [abilityKey]: name, [paramsKey]: params } });
  const out = unwrap(r);
  if (r?.isError || out?.success === false || out?.error) {
    throw new Error(`${name} failed: ${typeof out === "string" ? out : JSON.stringify(out).slice(0, 800)}`);
  }
  return out?.data ?? out;
}

// ---------- assets (WordPress core REST media endpoint) ----------
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif" };
const cachePath = path.resolve("output", "mcp-media-cache.json");
let cache = {};
const verifiedMedia = new Set();
let uploadedCount = 0, reusedCount = 0, staleCount = 0;
try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}

function findLocal(url) {
  let dir = treeDir;
  for (let i = 0; i < 5; i++) {
    const p = path.resolve(dir, url);
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  return null;
}
async function uploadAsset(localPath) {
  const filename = path.basename(localPath);
  const stat = fs.statSync(localPath);
  const key = `${SITE_BASE}|${localPath}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
  if (cache[key]) {
    if (verifiedMedia.has(key)) return cache[key];
    const live = await verifyCachedMedia(cache[key], { site: SITE_BASE, auth: AUTH });
    if (live) { cache[key] = live; verifiedMedia.add(key); reusedCount++; return live; }
    delete cache[key]; staleCount++;
    console.log(`   Deleted attachment detected; re-uploading ${filename}`);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  const res = await fetch(`${SITE_BASE}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": MIME[ext] || "application/octet-stream",
    },
    body: fs.readFileSync(localPath),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  if (!Number.isInteger(data.id) || data.id < 1 || !/^https?:\/\//i.test(data.source_url || "")) throw new Error("Media endpoint did not return a valid attachment ID and URL.");
  cache[key] = { id: data.id, url: data.source_url, filename };
  verifiedMedia.add(key); uploadedCount++;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  return cache[key];
}
// Any settings object with a local-looking `url` (image, icon.svg, background image...) gets swapped.
const isLocalRef = (o) =>
  o && typeof o === "object" && typeof o.url === "string" && /\.(png|jpe?g|svg|webp|gif)$/i.test(o.url) && !/^(https?:|data:|\/\/)/i.test(o.url);
function* walkRefs(node) {
  if (Array.isArray(node)) { for (const v of node) yield* walkRefs(v); return; }
  if (!node || typeof node !== "object") return;
  if (isLocalRef(node)) yield node;
  for (const v of Object.values(node)) yield* walkRefs(v);
}
async function resolveAssets() {
  const refs = [...walkRefs(tree.map((e) => e.settings))];
  const failures = [];
  let done = 0;
  for (const ref of refs) {
    const original = ref.url;
    const local = findLocal(original);
    if (!local) { failures.push(`${original}  (file not found)`); continue; }
    try {
      const up = await uploadAsset(local);
      ref.id = up.id;
      ref.url = up.url;
      if (typeof ref.full === "string") ref.full = up.url;
      if ("filename" in ref) ref.filename = up.filename;
      done++;
    } catch (e) {
      failures.push(`${original}  (${e.message})`);
    }
  }
  console.log(`   Assets: ${refs.length} references, ${done} uploaded/reused, ${failures.length} failed.`);
  console.log(`   Unique assets: ${uploadedCount} uploaded, ${reusedCount} verified on site, ${staleCount} stale cache entries replaced.`);
  if (failures.length) {
    const unique = [...new Set(failures)];
    console.log("   Failed (these stay as local paths and will show broken in Bricks):");
    for (const f of unique.slice(0, 10)) console.log("     - " + f);
    if (unique.length > 10) console.log(`     ...and ${unique.length - 10} more`);
    if (unique.some((f) => /svg/i.test(f) && /40\d/.test(f))) {
      console.log("   Hint: WordPress blocks SVG uploads by default. Enable SVG uploads (e.g. the Safe SVG plugin) or tell me and I'll add a Bricks upload-media fallback.");
    }
  }
  return failures;
}


// ---------- save, optionally auto-applying Bricks' own key suggestions ----------
const REJECT_RE = /Invalid value for "settings\.([^"]+)"\. Expected a registered setting for the '([^']+)' element(?:; did you mean '([^']+)'\?)?/;
async function saveElements(postId) {
  const renames = [];
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const saved = await ability("bricks/set-page-elements", { postId, elements: tree });
      return { saved, renames };
    } catch (e) {
      const m = e.message.match(REJECT_RE);
      if (!m) throw e;
      const [, key, type, suggestion] = m;
      if (!FIX_KEYS) {
        e.message += `\n\nBricks rejected setting "${key}" on '${type}' elements${suggestion ? ` (suggests "${suggestion}")` : ""}.\nRe-run with --fix-keys to apply Bricks' suggestions to a patched copy and see every mismatch.`;
        throw e;
      }
      if (!suggestion || key.includes(".")) {
        throw new Error(`Cannot auto-fix ${type}.${key}: ${suggestion ? "nested key" : "Bricks gave no replacement suggestion"}.${renames.length ? " Renames so far: " + JSON.stringify(renames) : ""}`);
      }
      let n = 0;
      for (const el of tree) {
        if (el.name !== type || !el.settings || !(key in el.settings)) continue;
        if (suggestion in el.settings) throw new Error(`Cannot rename ${type}.${key}: "${suggestion}" already exists on element ${el.id}.`);
        el.settings[suggestion] = el.settings[key];
        delete el.settings[key];
        n++;
      }
      if (!n) throw new Error(`Bricks rejected ${type}.${key} but no matching element was found to rename.`);
      renames.push({ type, from: key, to: suggestion, elements: n });
      console.log(`   Bricks rejected ${type}.${key}; renaming to ${suggestion} on ${n} element(s) and retrying...`);
    }
  }
  throw new Error("Gave up after 150 key fixes - something systematic is wrong. Send me the output.");
}

// ---------- main ----------
async function main() {
  console.log(`Tree: ${treePath}  (${tree.length} elements)`);
  console.log("1) Connecting to MCP...");
  await connect();
  const v = await ability("bricks/get-mcp-version", {});
  console.log(`   OK. Bricks ${v.bricksVersion}, abilities ${v.bricksAbilitiesVersion}, adapter ${v.adapterVersion}.`);

  let assetFailures = [];
  if (RENDER_ONLY || NO_ASSETS) {
    console.log("2) Assets: skipped.");
  } else {
    console.log("2) Uploading assets...");
    assetFailures = await resolveAssets();
    if (assetFailures.length) throw new Error(`Asset resolution failed (${assetFailures.length} references). Not saving broken image URLs.`);
  }

  if(flag('--assets-only')) { console.log('Assets ready. No page was created or saved.'); return; }
  let postId = PAGE_ARG;
  let created = null;
  if (!postId) {
    const title = opt("--title") || `MCP Test - ${label}`;
    console.log(`3) Creating DRAFT page "${title}"...`);
    created = await ability("bricks/create-post", { title, postType: "page", status: "draft" });
    postId = created.postId;
    console.log(`   Created page ${postId} (draft). Builder: ${created.builderUrl}`);
  } else {
    console.log(`3) Using existing page ${postId}.`);
  }

  console.log("4) Render check (nothing saved)...");
  const rendered = await ability("bricks/render-elements", { postId, elements: tree, area: "content", responseFormat: "detailed" });
  const html = rendered.html || "";
  const css = rendered.css || "";
  const renderFile = path.join(outDir, `mcp-render-${label}.html`);
  fs.writeFileSync(renderFile, `<!doctype html><meta charset="utf-8"><style>${css}</style>\n${html}`);
  const rendered_ids = (html.match(/id="brxe-/g) || []).length;
  console.log(`   Rendered: ${html.length} chars HTML, ${css.length} chars CSS, ${rendered_ids} brxe- elements (tree has ${tree.length}).`);
  console.log(`   Saved ${renderFile}`);
  if (!html.trim()) throw new Error("render-elements returned empty HTML - not saving. Check the tree.");
  if (rendered_ids < tree.length * 0.5) {
    console.log("   WARNING: far fewer rendered elements than the tree has. Some may be dropped or invalid.");
  }

  if (RENDER_ONLY) {
    console.log("\nRender-only: done. Nothing was saved.");
    return;
  }

  console.log("5) Saving elements (set-page-elements)...");
  const { saved, renames } = await saveElements(postId);
  fs.writeFileSync(path.join(treeDir, "injected-tree.json"), JSON.stringify(tree, null, 2));
  if (renames.length) {
    const fixedPath = path.join(outDir, `mcp-fixed-tree-${label}.json`);
    fs.writeFileSync(fixedPath, JSON.stringify(tree, null, 2));
    console.log(`   Key renames applied (${renames.length}): ${renames.map((r) => `${r.type}.${r.from} -> ${r.to}`).join(", ")}`);
    console.log(`   Patched tree saved to ${fixedPath}. The compiler should emit these keys itself.`);
  }
  console.log(`   Saved ${saved.elementCount} elements. changed=${saved.changed}. Undo revisionId: ${saved.revisionId ?? "none (page was empty)"}`);

  try {
    await ability("bricks/regenerate-css-files", {});
    console.log("6) CSS files regenerated.");
  } catch (e) {
    console.log("6) CSS regenerate skipped (" + e.message.split("\n")[0].slice(0, 120) + ")");
  }

  const report = { postId, created: !!created, builderUrl: created?.builderUrl, permalink: created?.permalink, elementCount: saved.elementCount, revisionId: saved.revisionId, assetFailures, keyRenames: renames, tree: treePath, at: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, `mcp-inject-${label}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(treeDir, "inject-report.json"), JSON.stringify(report, null, 2));
  console.log("\nDone.");
  if (created?.builderUrl) console.log("Open in builder: " + created.builderUrl);
  if (created?.permalink) console.log("Preview (draft, log in first): " + created.permalink);
  console.log(`Re-run into the same page with:  --page ${postId}`);
}

main().catch((e) => {
  console.error("\nFAILED: " + e.message);
  if (/401|403/.test(e.message)) console.error("Auth problem: check .env username matches the account that created the application password.");
  process.exit(1);
});
