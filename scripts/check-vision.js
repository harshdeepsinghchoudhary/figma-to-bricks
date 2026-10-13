import "dotenv/config";
import { visionConfig } from "./vision-client.js";
import { checkOllama } from "./provider-health.js";
try {
  const config = visionConfig();
  console.log(`Selected vision provider: ${config.provider}, model: ${config.model}`);
  if (config.provider === "ollama") { const checked = await checkOllama(config); console.log(`Installed model supports images: ${checked.vision}`); }
  const url = config.provider === "ollama" ? `${config.host}/api/tags` : config.provider === "anthropic" ? null : `${config.endpoint}/models`;
  if (url) {
    const r = await fetch(url, { headers: config.key ? { Authorization: `Bearer ${config.key}` } : {}, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Provider models endpoint HTTP ${r.status}`);
    const body = await r.json();
    const models = (body.data || body.models || []).map((m) => m.id || m.name);
    console.log(`Configured model available: ${models.includes(config.model)}`);
    if (!models.includes(config.model)) { console.log("Vision-like models:", models.filter((m) => /qwen|vision|vl|llava|llama.?4|gemma/i.test(m))); process.exitCode = 1; }
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
