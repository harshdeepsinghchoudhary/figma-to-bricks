import "dotenv/config";
import { providerHttpError } from "./provider-health.js";

export function visionConfig(env = process.env) {
  let provider = env.VISUAL_PROVIDER || env.AI_PROVIDER;
  if (!provider || provider === "auto") {
    provider = ["anthropic", "gemini", "groq", "nvidia"].find((p) => env[`${p.toUpperCase()}_API_KEY`] && (p === "groq" || env.VISUAL_MODEL || env[`${p.toUpperCase()}_MODEL`])) || (env.OLLAMA_VISION_MODEL || env.OLLAMA_MODEL ? "ollama" : null);
  }
  if (!provider) throw new Error("Set VISUAL_PROVIDER and VISUAL_MODEL to a vision model, or configure OLLAMA_MODEL. Use --no-visual only to explicitly skip visual QA.");
  const model = env.VISUAL_MODEL || (provider === "ollama" ? env.OLLAMA_VISION_MODEL : null) || env[`${provider.toUpperCase()}_MODEL`] || (provider === "groq" ? "qwen/qwen3.8-27b" : null);
  if (!model) throw new Error(`Set VISUAL_MODEL or ${provider.toUpperCase()}_MODEL to an image-capable model.`);
  const endpoints = { groq: "https://api.groq.com/openai/v1", gemini: "https://generativelanguage.googleapis.com/v1beta/openai", nvidia: env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1" };
  if (!["anthropic", "ollama", ...Object.keys(endpoints)].includes(provider)) throw new Error(`Unsupported VISUAL_PROVIDER: ${provider}`);
  const key = env[`${provider.toUpperCase()}_API_KEY`];
  if (provider !== "ollama" && !key) throw new Error(`Missing ${provider.toUpperCase()}_API_KEY`);
  return { provider, model, key, endpoint: endpoints[provider], host: env.OLLAMA_HOST || "http://localhost:11434" };
}

export async function callVision(prompt, images, config = visionConfig()) {
  try { return { ...await callVisionSingle(prompt, images, config), provider: config.provider, model: config.model }; }
  catch (error) {
    const model = process.env.OLLAMA_VISION_MODEL;
    if (config.provider === "ollama" || !model) throw error;
    console.warn(`Existing vision provider failed; trying local Ollama vision model ${model}.`);
    const fallback = visionConfig({ ...process.env, VISUAL_PROVIDER: "ollama", VISUAL_MODEL: model });
    try { return { ...await callVisionSingle(prompt, images, fallback), provider: "ollama", model, fallbackReason: error.message }; }
    catch (localError) { error.fallbackError = localError.message; error.message += `\nOllama fallback also failed: ${localError.message}. Check the local server/model with npm run check:vision.`; throw error; }
  }
}

async function callVisionSingle(prompt, images, config) {
  const maxTokens = Number(process.env.VISUAL_MAX_TOKENS || 6000);
  if (config.provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.key, maxRetries: 1, timeout: 180000,
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {}) });
    const response = await client.messages.create({ model: config.model, max_tokens: maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }))] }] });
    if (response.stop_reason === "max_tokens") throw new Error("Vision response truncated; increase VISUAL_MAX_TOKENS.");
    return { text: response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), usage: response.usage };
  }
  const ollama = config.provider === "ollama";
  const body = ollama ? { model: config.model, stream: false, format: "json", options: { temperature: 0, num_ctx: Number(process.env.OLLAMA_NUM_CTX || 8192), num_predict: maxTokens }, messages: [{ role: "user", content: prompt, images }] }
    : { model: config.model, max_tokens: maxTokens, temperature: 0, ...(["groq", "gemini"].includes(config.provider) ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }))] }] };
  let response;
  try { response = await fetch(ollama ? `${config.host.replace(/\/$/, "")}/api/chat` : `${config.endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(!ollama ? { Authorization: `Bearer ${config.key}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.VISUAL_TIMEOUT_MS) || 600000) }); }
  catch (error) {
    if (!ollama) throw error;
    throw new Error(`Ollama inference is unavailable at ${config.host}: ${error.cause?.code || error.message}. Start its server and verify the model with npm run doctor -- --ollama. This does not prove GPU incompatibility.`);
  }
  if (!response.ok) throw providerHttpError(config.provider, response.status, await response.text(), response.headers.get("retry-after"));
  const data = await response.json();
  if (data.choices?.[0]?.finish_reason === "length" || data.done_reason === "length") throw new Error("Vision response truncated.");
  return { text: ollama ? data.message?.content : data.choices?.[0]?.message?.content, usage: data.usage || { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count } };
}
