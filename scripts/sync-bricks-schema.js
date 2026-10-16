// Runtime discovery changes local schema snapshots only; never WordPress content.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectReadOnlyBricks } from './bricks-mcp-readonly.js';

export const DEFAULT_SCHEMA_TYPES = ['section', 'container', 'div', 'block', 'heading', 'text', 'text-basic', 'button', 'image', 'icon', 'text-link', 'nav-menu', 'nav-nested', 'dropdown', 'toggle', 'offcanvas', 'slider-nested', 'tabs-nested', 'accordion-nested', 'form'];

export function safeElementNames(names) {
  if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(name))) throw new Error('Element names must be safe registered identifiers');
  return [...new Set(names)];
}

export function validateRuntimeSchema(schema, name) {
  if (schema?.name !== name || !schema.controls || typeof schema.controls !== 'object' || Array.isArray(schema.controls)) throw new Error(`Unexpected runtime schema for ${name}`);
  return schema;
}

export function designReferences(context) {
  const select = (rows, keys) => (Array.isArray(rows) ? rows : []).map(row => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  return {
    counts: context.counts || {},
    globalClasses: select(context.globalClasses, ['id', 'name']),
    globalVariables: select(context.globalVariables, ['id', 'name', 'value', 'category']),
    components: select(context.components, ['id', 'label']),
    truncated: context.truncated || {},
  };
}

export async function syncBricksSchema({ client, elements = DEFAULT_SCHEMA_TYPES, dir = path.resolve('schema/runtime'), backupDir = path.resolve('.review-work', `schema-sync-${Date.now()}`), log = console.log } = {}) {
  const requested = safeElementNames(elements);
  client ||= await connectReadOnlyBricks();
  const version = await client.call('bricks/get-mcp-version');
  const status = await client.call('bricks/list-ability-status', { includeDisabled: true });
  const enabled = new Set((status.abilities || []).filter(ability => ability.enabled).map(ability => ability.name));
  for (const ability of ['bricks/list-element-types', 'bricks/get-element-schema', 'bricks/list-breakpoints']) {
    if (!enabled.has(ability)) throw new Error(`Required read-only ability ${ability} is disabled or unavailable`);
  }
  const catalog = [];
  for (let page = 1; ; page++) {
    const chunk = await client.call('bricks/list-element-types', { page, perPage: 200 });
    if (!Array.isArray(chunk.items)) throw new Error('Invalid registered element catalog');
    catalog.push(...chunk.items);
    if (!chunk.hasMore) break;
    if (page >= 100) throw new Error('Element catalog pagination did not finish');
  }
  const registered = new Set(catalog.map(item => item.name));
  const missing = requested.filter(name => !registered.has(name));
  if (missing.length) throw new Error(`Element types are not registered on this site: ${missing.join(', ')}`);
  const collected = {};
  for (const name of requested) {
    collected[name] = validateRuntimeSchema(await client.call('bricks/get-element-schema', { elementName: name }), name);
    log(`${name}: ${Object.keys(collected[name].controls).length} registered controls`);
  }
  const breakpoints = await client.call('bricks/list-breakpoints');
  if (!Array.isArray(breakpoints.breakpoints) || !breakpoints.baseKey || typeof breakpoints.isMobileFirst !== 'boolean') throw new Error('Invalid site breakpoint configuration');
  const siteContext = { site: client.site, fetchedAt: new Date().toISOString(), version, breakpoints, abilities: status, registeredElements: catalog.map(item => item.name) };
  if (enabled.has('bricks/get-design-context')) siteContext.designSystem = designReferences(await client.call('bricks/get-design-context', { responseFormat: 'summary' }));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const files = { ...Object.fromEntries(Object.entries(collected).map(([name, schema]) => [`${name}.json`, schema])), 'site-context.json': siteContext, 'manifest.json': { source: 'Bricks runtime get-element-schema', site: client.site, fetchedAt: siteContext.fetchedAt, version, elements: requested } };
  for (const [name, data] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(backupDir, name));
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
    fs.renameSync(temporary, target);
  }
  log(`Runtime schemas saved in ${dir}. Previous snapshots: ${backupDir}. No WordPress content was changed.`);
  return { elements: requested, siteContext };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv.slice(2);
  const option = input.find(argument => argument.startsWith('--elements='));
  const unknown = input.filter(argument => argument !== option);
  if (unknown.length) { console.error(`Unknown options: ${unknown.join(', ')}`); process.exitCode = 1; }
  else syncBricksSchema({ ...(option ? { elements: option.slice('--elements='.length).split(',') } : {}) }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

