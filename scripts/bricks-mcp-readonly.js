// Read-only Bricks discovery transport. Credentials are used only in HTTP headers.
export function toolPayload(result) {
  if (result?.isError) throw new Error('MCP tool returned an error');
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find(item => item.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('Missing MCP tool response');
  try { return JSON.parse(text); } catch { throw new Error('MCP tool response was not JSON'); }
}

export function unwrapAbility(result) {
  if (result?.success === false || result?.error) throw new Error('Bricks read-only ability failed');
  return result?.data ?? result;
}

export async function connectReadOnlyBricks({ endpoint = process.env.WP_API_URL, username = process.env.WP_API_USERNAME, password = process.env.WP_API_PASSWORD, fetchImpl = fetch } = {}) {
  if (!endpoint || !username || !password) throw new Error('Configure WP_API_URL, WP_API_USERNAME and WP_API_PASSWORD');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported MCP endpoint protocol');
  let sessionId;
  let protocolVersion;
  let id = 1;
  async function rpc(method, params = {}, notify = false) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
    const body = { jsonrpc: '2.0', method, params };
    if (!notify) body.id = id++;
    const response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    sessionId = response.headers.get('mcp-session-id') || sessionId;
    const raw = await response.text();
    // Do not echo server bodies: authentication errors can contain sensitive information.
    if (!response.ok) throw new Error(`MCP HTTP ${response.status} on ${method}`);
    if (notify || !raw.trim()) return null;
    const payload = response.headers.get('content-type')?.includes('text/event-stream')
      ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).pop()
      : raw;
    const result = JSON.parse(payload);
    if (result.error) throw new Error(`MCP RPC error on ${method}`);
    return result.result;
  }
  const server = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'figma-bricks-schema-reader', version: '1.0.0' } });
  protocolVersion = server?.protocolVersion;
  await rpc('notifications/initialized', {}, true);
  const { tools } = await rpc('tools/list');
  const infoTool = tools.find(tool => /get-ability-info/.test(tool.name));
  const executeTool = tools.find(tool => /execute-ability/.test(tool.name));
  if (!infoTool || !executeTool) throw new Error('Bricks MCP dispatcher and ability information tools are required');
  const infoKey = Object.keys(infoTool.inputSchema?.properties || {}).find(key => /ability|name/.test(key)) || 'ability_name';
  const executeKeys = Object.keys(executeTool.inputSchema?.properties || {});
  const abilityKey = executeKeys.find(key => /ability|name/.test(key)) || 'ability_name';
  const parametersKey = executeKeys.find(key => /param|input|arg/.test(key)) || 'parameters';
  const checked = new Map();
  async function info(name) {
    if (!checked.has(name)) checked.set(name, unwrapAbility(toolPayload(await rpc('tools/call', { name: infoTool.name, arguments: { [infoKey]: name } }))));
    return checked.get(name);
  }
  async function call(name, parameters = {}) {
    const definition = await info(name);
    if (definition.name !== name) throw new Error(`Ability ${name} is not registered`);
    const annotations = definition.meta?.annotations || definition.meta?.mcp?.annotations;
    if (annotations?.readonly !== true || annotations?.destructive === true) throw new Error(`Refusing unverified read-only ability ${name}`);
    return unwrapAbility(toolPayload(await rpc('tools/call', { name: executeTool.name, arguments: { [abilityKey]: name, [parametersKey]: parameters } })));
  }
  return { call, info, site: url.origin, server: server?.serverInfo, tools: tools.map(tool => tool.name) };
}
