export class ProviderError extends Error {
  constructor(message, { status, provider, retryAfterSeconds = null, quotaScope = null } = {}) {
    super(message); this.status = status; this.provider = provider; this.retryAfterSeconds = retryAfterSeconds; this.quotaScope = quotaScope;
    this.code = status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
  }
}

export function providerHttpError(provider, status, body, retryHeader = null) {
  let message = body;
  try { const json = JSON.parse(body); message = json.error?.message || json.error || body; } catch {}
  message = String(message);
  const duration = message.match(/try again in\s*(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i);
  let seconds = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : null;
  if (seconds === null && duration && duration.slice(1).some(Boolean)) seconds = Number(duration[1] || 0) * 3600 + Number(duration[2] || 0) * 60 + Number(duration[3] || 0);
  if (seconds === null && retryHeader) { const timestamp = Date.parse(retryHeader); if (Number.isFinite(timestamp)) seconds = Math.max(0, (timestamp - Date.now()) / 1000); }
  const quotaScope = /per day|\bTPD\b/i.test(message) ? "daily" : /per minute|\bTPM\b|\bITPM\b/i.test(message) ? "minute" : null;
  return new ProviderError(`Vision ${provider} HTTP ${status}: ${message.slice(0, 650)}`, { status, provider, retryAfterSeconds: seconds, quotaScope });
}

export async function checkOllama(config, request = fetch) {
  const host = config.host.replace(/\/$/, "");
  let response;
  try { response = await request(`${host}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: config.model }), signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw new Error(`Ollama server is unreachable at ${host}. Start the Ollama app or run ollama serve. This does not establish a GPU incompatibility. (${error.cause?.code || error.message})`); }
  if (!response.ok) throw new Error(`Ollama model ${config.model} is unavailable (HTTP ${response.status}). Install it with: ollama pull ${config.model}`);
  const model = await response.json();
  if (!model.capabilities?.includes("vision")) throw new Error(`Ollama model ${config.model} does not report vision capability. Select an image-capable model; a text-only model cannot review screenshots.`);
  return { model: config.model, vision: true, capabilities: model.capabilities };
}
