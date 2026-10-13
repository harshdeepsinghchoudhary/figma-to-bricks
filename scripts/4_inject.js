/**
 * Stage 4: push bricks-tree.json into a WordPress page's Bricks content.
 *
 * Usage:
 *   node scripts/4_inject.js output/<frame-name> <wp-page-id>
 *
 * Two things happen here that need real credentials/access to test:
 *   1. Upload each local asset file to the WP Media Library, get back a real
 *      attachment id + URL, and rewrite bricks-tree.json's image settings.
 *   2. Write the final array into the page's `_bricks_page_content_2` postmeta.
 *
 * WordPress core REST API does not expose arbitrary postmeta writes by
 * default. Two ways to actually do step 2, pick one:
 *   A) Install/enable a small "expose postmeta to REST" allowlist (e.g. via
 *      register_post_meta with show_in_rest, in a tiny must-use plugin) for
 *      just `_bricks_page_content_2` — cleanest, keeps everything over HTTPS
 *      with your Application Password.
 *   B) Direct DB write (mysql2) if you're running this against LocalWP or
 *      have DB access — faster to get moving, less "proper."
 *
 * This script implements (A) and assumes that mu-plugin exists; the
 * commented-out block below shows (B) as a fallback.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { isDeepStrictEqual } from "node:util";
import { validateBricks } from "./bricks-validator.js";

const frameDir = process.argv[2];
const pageId = process.argv[3];
if (!frameDir || !pageId) {
  console.error("Usage: node scripts/4_inject.js output/<frame-name> <wp-page-id>");
  process.exit(1);
}

const { WP_BASE_URL, WP_APP_USER, WP_APP_PASSWORD } = process.env;
if (!WP_BASE_URL || !WP_APP_USER || !WP_APP_PASSWORD) {
  console.error("Missing WP_BASE_URL / WP_APP_USER / WP_APP_PASSWORD in .env");
  process.exit(1);
}

const authHeader =
  "Basic " + Buffer.from(`${WP_APP_USER}:${WP_APP_PASSWORD}`).toString("base64");

async function uploadAsset(localPath) {
  const filename = path.basename(localPath);
  const fileBuf = fs.readFileSync(localPath);
  const ext = path.extname(filename).slice(1);
  const mime = { png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg" }[ext] || "application/octet-stream";

  const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": mime,
    },
    body: fileBuf,
  });
  if (!res.ok) throw new Error(`Media upload failed for ${filename}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!Number.isInteger(data.id) || data.id < 1 || !/^https?:\/\//i.test(data.source_url || "")) throw new Error("Media endpoint did not confirm a valid attachment ID and URL.");
  return { id: data.id, url: data.source_url };
}

async function main() {
  const treePath = path.join(frameDir, "bricks-tree.json");
  if (!fs.existsSync(treePath)) {
    console.error(`Missing ${treePath} — run stage 3 first.`);
    process.exit(1);
  }
  const tree = JSON.parse(fs.readFileSync(treePath, "utf-8"));
  const checked = validateBricks(tree);
  if (checked.errors.length) throw new Error(`Invalid Bricks tree: ${checked.errors.join("; ")}`);

  // Resolve local asset paths to real WP attachments.
  const uploadCache = new Map();
  // Image elements use settings.image, icon elements use settings.icon.svg: both hold local paths to swap for WP attachments.
  async function resolveAssetRef(ref) {
    if (!ref?.url || /^(https?:|data:|\/\/)/i.test(ref.url)) return;
    const localPath = path.join(frameDir, ref.url);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Asset file missing: ${localPath}. Not saving broken image URLs.`);
    }
    if (!uploadCache.has(localPath)) {
      console.log(`Uploading ${localPath}...`);
      uploadCache.set(localPath, await uploadAsset(localPath));
    }
    const uploaded = uploadCache.get(localPath);
    ref.id = uploaded.id;
    ref.url = uploaded.url;
    if (ref.full) ref.full = uploaded.url;
    if (ref.filename !== undefined) ref.filename = path.basename(localPath);
  }
  async function resolveRefs(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && /\.(png|jpe?g|svg|webp|gif)$/i.test(value.url)) await resolveAssetRef(value);
    for (const child of Object.values(value)) await resolveRefs(child);
  }
  for (const el of tree) await resolveRefs(el.settings);

  // --- Option A: mu-plugin exposes _bricks_page_content_2 via REST ---
  const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/pages/${pageId}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ meta: { _bricks_page_content_2: tree } }),
  });
  if (!res.ok) {
    console.error(`REST update failed: ${res.status} ${await res.text()}`);
    console.error(
      "\nIf this 403s or silently no-ops, _bricks_page_content_2 likely isn't\n" +
        "registered with show_in_rest yet. See the comment at the top of this\n" +
        "file for the mu-plugin snippet, or fall back to a direct DB write."
    );
    process.exit(1);
  }
  const updated = await res.json();
  let persisted = updated.meta?._bricks_page_content_2;
  if (typeof persisted === "string") { try { persisted = JSON.parse(persisted); } catch {} }
  if (!isDeepStrictEqual(persisted, tree)) throw new Error("REST response did not confirm the Bricks content was saved. Check the registered postmeta schema; an HTTP 200 alone is not proof of injection.");
  fs.writeFileSync(path.join(frameDir, "injected-tree.json"), JSON.stringify(tree, null, 2));
  fs.writeFileSync(path.join(frameDir, "inject-report.json"), JSON.stringify({ postId: Number(pageId), elementCount: tree.length, at: new Date().toISOString(), transport: "rest" }, null, 2));
  console.log(`Injected ${tree.length} element(s) into page ${pageId}.`);
  console.log(`Now: regenerate Bricks CSS cache (Bricks → Tools → Clear Cache) before measuring.`);

  /* --- Option B: direct DB write (uncomment + `npm i mysql2`) ---
  import mysql from "mysql2/promise";
  const conn = await mysql.createConnection({ host: "localhost", user, password, database });
  await conn.execute(
    "UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = '_bricks_page_content_2'",
    [JSON.stringify(tree), pageId]
  );
  await conn.end();
  */
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
