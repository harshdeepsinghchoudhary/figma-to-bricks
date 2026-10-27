import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safeElementNames, validateRuntimeSchema, designReferences, syncBricksSchema } from '../scripts/sync-bricks-schema.js';
import { connectReadOnlyBricks, toolPayload, unwrapAbility } from '../scripts/bricks-mcp-readonly.js';

test('runtime schema sync rejects unsafe and missing element names before writing', async () => {
  assert.throws(() => safeElementNames(['../.env']), /safe registered/);
  assert.throws(() => safeElementNames(['nav-nested/../../secret']), /safe registered/);
  assert.deepEqual(safeElementNames(['form', 'form']), ['form']);
  assert.throws(() => validateRuntimeSchema({ name: 'form', controls: [] }, 'form'), /Unexpected/);
  const client = { site: 'https://example.test', call: async name => {
    if (name === 'bricks/get-mcp-version') return {};
    if (name === 'bricks/list-ability-status') return { abilities: ['bricks/list-element-types', 'bricks/get-element-schema', 'bricks/list-breakpoints'].map(name => ({ name, enabled: true })) };
    if (name === 'bricks/list-element-types') return { items: [{ name: 'form' }], hasMore: false };
    throw new Error(`Unexpected read ${name}`);
  } };
  await assert.rejects(syncBricksSchema({ client, elements: ['invented-element'], log() {} }), /not registered/);
});

test('runtime sync preserves previous snapshots and exact site breakpoints without arbitrary design data', async () => {
  const base = path.resolve('.review-work'); fs.mkdirSync(base, { recursive: true });
  const work = fs.mkdtempSync(path.join(base, 'schema-sync-test-'));
  const dir = path.join(work, 'runtime'); const backupDir = path.join(work, 'backups');
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'form.json'), 'original snapshot');
  const calls = [];
  const client = { site: 'https://example.test', call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'bricks/get-mcp-version') return { bricksVersion: '2.4.2' };
    if (name === 'bricks/list-ability-status') return { abilities: ['bricks/list-element-types', 'bricks/get-element-schema', 'bricks/list-breakpoints', 'bricks/get-design-context'].map(name => ({ name, enabled: true })) };
    if (name === 'bricks/list-element-types') return { items: [{ name: 'form' }], hasMore: false };
    if (name === 'bricks/get-element-schema') return { name: args.elementName, nestable: false, controls: { fields: { type: 'repeater' } } };
    if (name === 'bricks/list-breakpoints') return { baseKey: 'desktop', isMobileFirst: false, breakpoints: [{ key: 'desktop', width: 1300 }, { key: 'tablet_custom', width: 1000 }] };
    if (name === 'bricks/get-design-context') return { counts: { globalClasses: 1 }, globalClasses: [{ id: 'aaaaaa', name: 'card', password: 'excluded' }], globalVariables: [{ id: 'bbbbbb', name: 'space', value: '16px' }], arbitrarySecret: 'excluded' };
    throw new Error(`Unexpected read ${name}`);
  } };
  try {
    const result = await syncBricksSchema({ client, elements: ['form'], dir, backupDir, log() {} });
    assert.equal(fs.readFileSync(path.join(backupDir, 'form.json'), 'utf8'), 'original snapshot');
    assert.equal(result.siteContext.breakpoints.breakpoints[1].key, 'tablet_custom');
    const saved = fs.readFileSync(path.join(dir, 'site-context.json'), 'utf8');
    assert(!saved.includes('excluded'));
    assert(calls.every(({ name }) => /\/(get|list)-/.test(name)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))).elements, ['form']);
  } finally {
    const target = path.resolve(work);
    assert(target.startsWith(base + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('read-only MCP transport checks actual readonly annotation before execution', async () => {
  let executes = 0;
  const mock = async (_url, request) => {
    const body = JSON.parse(request.body);
    if(body.method !== 'initialize') assert.equal(request.headers['MCP-Protocol-Version'], '2025-03-26');
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'mock' } };
    else if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    else if (body.method === 'tools/list') result = { tools: [{ name: 'mcp-adapter-get-ability-info', inputSchema: { properties: { ability_name: {} } } }, { name: 'mcp-adapter-execute-ability', inputSchema: { properties: { ability_name: {}, parameters: {} } } }] };
    else if (body.params.name.includes('get-ability-info')) result = { structuredContent: { name: body.params.arguments.ability_name, meta: { annotations: { readonly: false, destructive: false } } } };
    else { executes++; result = {}; }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const client = await connectReadOnlyBricks({ endpoint: 'https://example.test/mcp', username: 'test', password: 'hidden', fetchImpl: mock });
  await assert.rejects(client.call('bricks/update-element'), /Refusing/);
  assert.equal(executes, 0);
  assert.throws(() => toolPayload({ isError: true }), /error/);
  assert.throws(() => unwrapAbility({ success: false, error: 'server secret' }), /failed/);
  assert.deepEqual(designReferences({ globalClasses: [{ id: 'x', name: 'card', extra: true }] }).globalClasses, [{ id: 'x', name: 'card' }]);
});
