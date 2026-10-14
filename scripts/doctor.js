import "dotenv/config";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { findBrowser } from "./preview.js";
import { visionConfig } from "./vision-client.js";
import { checkOllama } from "./provider-health.js";
let errors = 0;
const ok = (message) => console.log(`OK: ${message}`);
const fail = (message) => { errors++; console.error(`CHECK: ${message}`); };
const args = process.argv.slice(2), offline = args.includes("--offline");
const env = args.includes("--ollama") ? { ...process.env, VISUAL_PROVIDER: "ollama", VISUAL_MODEL: process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || "gemma3:4b" } : process.env;
console.log(`Node ${process.version}, platform ${process.platform}/${process.arch}`);
if (Number(process.versions.node.split(".")[0]) < 20) fail("Install Node.js 20 or newer.");
try { const sharp = (await import("sharp")).default; await sharp({ create: { width: 1, height: 1, channels: 4, background: "white" } }).png().toBuffer(); ok("Image processing works."); } catch (e) { fail(`Image processing failed: ${e.message}. Run npm ci on this device.`); }
if (args.includes("--visual") || args.includes("--ollama")) { try { ok(`Optional debugging browser: ${findBrowser()}`); } catch (e) { fail(e.message); } }
if (!fs.existsSync(".env")) fail("Create .env from .env.example and configure credentials locally.");
const ignored = spawnSync("git", ["check-ignore", ".env"], { encoding: "utf8" });
if (ignored.status === 0) ok(".env is excluded from Git."); else fail(".env is not confirmed ignored by Git; do not upload credentials.");
const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ".env"], { encoding: "utf8" });
if (tracked.status === 0) fail(".env is already tracked. Ignoring it does not remove it from Git history.");
const ollama = spawnSync("ollama", ["--version"], { encoding: "utf8", timeout: 10000 });
console.log(ollama.status === 0 ? `Ollama CLI: ${(ollama.stdout || ollama.stderr).trim()}` : "Ollama CLI not found here. A remote server is still usable via OLLAMA_HOST.");
const gpu = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"], { encoding: "utf8", timeout: 10000 });
if (gpu.status === 0) console.log(`NVIDIA GPU: ${gpu.stdout.trim()}`); else console.log("NVIDIA hardware was not detected by nvidia-smi; this is not an Ollama compatibility verdict.");
if (args.includes("--visual") || args.includes("--ollama")) try {
  const config = visionConfig(env); ok(`Visual provider: ${config.provider}, model: ${config.model}`);
  if (!offline && config.provider === "ollama") { const checked = await checkOllama(config); ok(`Ollama server reachable; ${checked.model} supports images.`); }
  else console.log("Provider network check skipped. Use npm run check:vision for the configured remote provider.");
} catch (e) { fail(e.message); }
console.log(errors ? `${errors} setup check(s) need attention.` : "Setup checks passed.");
process.exitCode = errors ? 1 : 0;
