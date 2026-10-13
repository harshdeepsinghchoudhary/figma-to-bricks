// Exercise all visual request crops and context budgets without calling a real model.
// The mock returns no judgments; its report is a transport test, not visual approval.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { visualReview } from "../scripts/6_visual_review.js";
const source = path.resolve(process.argv[2] || "output/casinofx-homepage");
const target = path.resolve(".review-work", `preflight-${path.basename(source)}-${Date.now()}`);
fs.mkdirSync(path.join(target, "merged"), { recursive: true });
for (const file of ["figma-node.json", "screenshot.png"]) fs.copyFileSync(path.join(source, file), path.join(target, file));
for (const file of ["section-map.json", "bricks-source-map.json"]) fs.copyFileSync(path.join(source, "merged", file), path.join(target, "merged", file));
const tree = JSON.parse(fs.readFileSync(path.join(source, "merged", "bricks-tree.json")));
function refs(value) {
  if (!value || typeof value !== "object") return;
  for (const key of ["url", "full"]) if (typeof value[key] === "string" && !/^(https?:|data:|\/\/)/i.test(value[key])) value[key] = path.resolve(source, "merged", value[key]);
  for (const child of Object.values(value)) refs(child);
}
refs(tree); fs.writeFileSync(path.join(target, "merged", "bricks-tree.json"), JSON.stringify(tree));
const manifest = JSON.parse(fs.readFileSync(path.join(source, "asset-manifest.json"))).map((a) => ({ ...a, file: path.resolve(source, a.file) }));
fs.writeFileSync(path.join(target, "asset-manifest.json"), JSON.stringify(manifest));
let requests = 0; const dimensions = [];
const server = http.createServer(async (req, res) => {
  try {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), message = body.messages[0];
    if (message.images?.length !== 2) throw new Error("Both images are required.");
    for (const image of message.images) {
      const meta = await sharp(Buffer.from(image, "base64")).metadata(); dimensions.push({ width: meta.width, height: meta.height });
      if (meta.width < 32 || meta.height < 32 || meta.width > 640 || meta.height > 900) throw new Error(`Invalid crop ${meta.width}x${meta.height}`);
    }
    requests++; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message: { content: '{"issues":[],"patches":[]}' } }));
  } catch (e) { res.statusCode = 400; res.end(e.message); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const result = await visualReview(target, { config: { provider: "ollama", model: "transport-test-only", host: `http://127.0.0.1:${server.address().port}` }, iterations: 0 });
  result.report.status = result.ok ? "transport-passed" : "transport-failed";
  result.report.testOnly = true;
  fs.writeFileSync(result.reportFile, JSON.stringify(result.report, null, 2));
  fs.writeFileSync(path.join(target, "merged", "visual-report.json"), JSON.stringify(result.report, null, 2));
  const summary = { type: "transport preflight only, no real visual judgments", source, requests, images: dimensions.length, remainingRenderIssues: result.report.remainingIssues, report: result.reportFile };
  fs.writeFileSync(path.join(target, "preflight.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exitCode = result.ok ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await new Promise((resolve) => server.close(resolve)); }
