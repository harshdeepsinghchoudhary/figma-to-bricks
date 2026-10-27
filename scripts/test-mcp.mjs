#!/usr/bin/env node
// Test the WordPress MCP Adapter endpoint and list Bricks abilities.
// Needs Node 18+ (built-in fetch). No dependencies.
//
// Usage (PowerShell):
//   $env:WP_API_URL="https://casinodesign.bcit.in/wp-json/mcp/mcp-adapter-default-server"
//   $env:WP_API_USERNAME="akshdeep@blackcapit.com"
//   $env:WP_API_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
//   node scripts/test-mcp.mjs                 # connect + list tools + discover abilities
//   node scripts/test-mcp.mjs <ability-name>  # also fetch schema for one ability
//   node scripts/test-mcp.mjs run <ability-name> '<json args>'   # EXECUTE an ability
//     e.g. node scripts/test-mcp.mjs run bricks/get-mcp-version '{}'
//          node scripts/test-mcp.mjs run bricks/list-ability-status @args.json
//
// Usage (bash): same, with `export WP_API_URL=...` etc.

import fs from 'node:fs';
import path from 'node:path';

// Load KEY=value lines from ./.env (no dependency). Real env vars win.
try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {}

const URL_ = process.env.WP_API_URL;
const USER = process.env.WP_API_USERNAME;
const PASS = process.env.WP_API_PASSWORD;

if (!URL_ || !USER || !PASS) {
  const missing = ['WP_API_URL', 'WP_API_USERNAME', 'WP_API_PASSWORD'].filter((k) => !process.env[k]);
  console.error('Missing: ' + missing.join(', ') + '\nPut them in a .env file in the folder you run node from, or set them in this same terminal.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
let sessionId = null;
let protocolVersion = null;
let nextId = 1;

async function rpc(method, params = {}, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method, params };
  if (!notify) body.id = nextId++;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: auth,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  const res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(body) });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${method}: ${text.slice(0, 500)}`);
  }
  if (notify || !text.trim()) return null;

  // Response may be plain JSON or an SSE stream.
  let payload = text.trim();
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const dataLines = payload.split('\n').filter((l) => l.startsWith('data:'));
    payload = dataLines.map((l) => l.slice(5).trim()).pop() || '{}';
  }
  const json = JSON.parse(payload);
  if (json.error) throw new Error(`RPC error on ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function toolText(result) {
  // MCP tool results: { content: [{type:'text', text:'...'}], structuredContent? }
  if (result?.structuredContent) return result.structuredContent;
  const t = result?.content?.find((c) => c.type === 'text')?.text;
  try { return JSON.parse(t); } catch { return t; }
}

const outDir = path.resolve('output');
fs.mkdirSync(outDir, { recursive: true });

try {
  // 1. Handshake
  console.log('1) initialize...');
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'figma-bricks-pipeline-test', version: '0.1.0' },
  });
  console.log('   OK. Server:', init?.serverInfo?.name, init?.serverInfo?.version,
    '| protocol:', init?.protocolVersion, '| session:', sessionId ? 'yes' : 'none');
  protocolVersion = init?.protocolVersion;
  await rpc('notifications/initialized', {}, { notify: true });

  // 2. Tools
  console.log('2) tools/list...');
  const { tools } = await rpc('tools/list');
  console.log('   Tools:', tools.map((t) => t.name).join(', '));
  fs.writeFileSync(path.join(outDir, 'mcp-tools.json'), JSON.stringify(tools, null, 2));

  const find = (frag) => tools.find((t) => t.name.toLowerCase().includes(frag));
  const discover = find('discover');
  const info = find('get-ability-info') || find('ability-info');
  const exec = find('execute');
  if (!discover) throw new Error('No discover-abilities tool found. See output/mcp-tools.json');

  // Run mode: execute one ability and print the result.
  if (process.argv[2] === 'run') {
    const ability = process.argv[3];
    const raw = process.argv[4];
    // Args can be inline JSON, or @path/to/file.json (safer in Windows PowerShell, which strips inner quotes).
    const args = !raw ? {} : raw.startsWith('@') ? JSON.parse(fs.readFileSync(raw.slice(1), 'utf8').replace(/^\uFEFF/, '')) : JSON.parse(raw);
    if (!ability) throw new Error('Usage: run <ability-name> \'<json args>\'');
    if (!exec) throw new Error('No execute-ability tool found.');
    const props = Object.keys(exec.inputSchema?.properties || {});
    const abilityKey = props.find((k) => /ability|name/i.test(k)) || 'ability_name';
    const paramsKey = props.find((k) => /param|input|arg/i.test(k)) || 'parameters';
    console.log(`Executing ${ability} via ${exec.name} (keys: ${abilityKey}, ${paramsKey})`);
    const r = await rpc('tools/call', { name: exec.name, arguments: { [abilityKey]: ability, [paramsKey]: args } });
    const out = toolText(r);
    const file = path.join(outDir, `run-${ability.replace(/[^\w.-]/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2).slice(0, 3000));
    console.log('\nFull result saved to', file);
    if (r?.isError || out?.success === false || out?.error) process.exitCode = 2;
    process.exit(process.exitCode || 0);
  }

  // 3. Discover abilities
  console.log(`3) calling ${discover.name}...`);
  const discovered = toolText(await rpc('tools/call', { name: discover.name, arguments: {} }));
  fs.writeFileSync(path.join(outDir, 'mcp-abilities.json'), JSON.stringify(discovered, null, 2));

  const list = Array.isArray(discovered) ? discovered : (discovered?.abilities || []);
  const names = list.map((a) => a.name || a.id || JSON.stringify(a));
  console.log(`   ${names.length} abilities found.`);
  const bricks = names.filter((n) => /brick/i.test(n));
  console.log('   Bricks abilities:', bricks.length ? '\n     ' + bricks.join('\n     ') : '(none matched "brick" — check output/mcp-abilities.json)');

  // 4. Optional: schema for one ability
  const target = process.argv[2];
  if (target && target !== 'run') {
    if (!info) throw new Error('No get-ability-info tool found.');
    const key = Object.keys(info.inputSchema?.properties || {})[0] || 'ability_name';
    console.log(`4) ${info.name} for "${target}" (arg key: ${key})...`);
    const detail = toolText(await rpc('tools/call', { name: info.name, arguments: { [key]: target } }));
    const file = path.join(outDir, `ability-${target.replace(/[^\w.-]/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify(detail, null, 2));
    console.log('   Saved', file);
  }

  console.log('\nDone. Execute tool available:', exec ? exec.name : 'NOT FOUND');
  console.log('Files saved in ./output: mcp-tools.json, mcp-abilities.json');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (/401|403/.test(e.message)) {
    console.error('Auth problem: check username, that the app password is copied exactly (spaces are fine), and that the user can access the site.');
  }
  process.exit(1);
}
