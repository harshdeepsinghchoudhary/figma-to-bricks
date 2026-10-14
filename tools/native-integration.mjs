// Optional backend integration probe; no page is saved and no screenshots are taken.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectReadOnlyBricks } from '../scripts/bricks-mcp-readonly.js';

const decode = value => value.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attribute(markup, name) {
  const match = markup.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`));
  return match ? decode(match[1] ?? match[2]) : undefined;
}
function markupFor(html, id) {
  const start = new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bid=["']brxe-${id}["'][^>]*>`, 'i').exec(html);
  if (!start) return '';
  const tag = start[1];
  const tokens = new RegExp(`</?${tag}\\b[^>]*>`, 'gi'); tokens.lastIndex = start.index;
  let depth = 0;
  for (let match; (match = tokens.exec(html));) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start.index, tokens.lastIndex);
  }
  return html.slice(start.index);
}
const classCount = (markup, name) => [...markup.matchAll(/\bclass=(?:"([^"]*)"|'([^']*)')/g)].filter(match => (match[1] ?? match[2]).split(/\s+/).includes(name)).length;

export function verifyNativeMarkup(tree, rendered, siteContext = {}) {
  const results = [];
  const breakpointWidths = Object.fromEntries((siteContext.breakpoints?.breakpoints || []).map(bp => [bp.key, bp.width]));
  for (const element of tree.filter(item => ['nav-nested', 'slider-nested', 'tabs-nested', 'accordion-nested', 'form'].includes(item.name))) {
    const markup = markupFor(rendered.html || '', element.id);
    const checks = []; const unverified = [];
    const check = (condition, passed) => checks.push({ condition, passed: !!passed });
    check(`Native .brxe-${element.name} parent exists`, classCount(markup, `brxe-${element.name}`) === 1);
    const opening = markup.slice(0, markup.indexOf('>') + 1);
    const settings = element.settings || {};
    const placeholder = classCount(markup, 'brx-nestable-children-placeholder') > 0;
    if (placeholder) unverified.push('This ability returned a nested-child placeholder; descendant frontend markup was not expanded.');
    if (element.name === 'nav-nested') {
      if (settings.ariaLabel) check('Navigation aria-label matches compiler settings', attribute(opening, 'aria-label') === settings.ariaLabel);
      if (settings.mobileMenu) check('Native mobile breakpoint data-toggle matches settings', attribute(opening, 'data-toggle') === settings.mobileMenu);
      if (!placeholder) {
        check('Native menu items wrapper exists', classCount(markup, 'brx-nav-nested-items') === 1);
        check('Native menu open and close toggles exist', classCount(markup, 'brxe-toggle') >= 2);
        if (tree.some(item => item.name === 'dropdown' && markup.includes(`brxe-${item.id}`))) check('Native dropdown content wrapper exists', classCount(markup, 'brx-dropdown-content') >= 1);
      }
    }
    if (element.name === 'slider-nested') {
      let options;
      try { options = JSON.parse(attribute(opening, 'data-splide') || '{}'); } catch { options = {}; }
      check('Splide track and list wrappers exist', classCount(markup, 'splide__track') === 1 && classCount(markup, 'splide__list') === 1);
      for (const key of ['perPage', 'perMove', 'type', 'speed', 'arrows', 'pagination', 'autoplay']) {
        if (settings[key] !== undefined) check(`Native Splide ${key} matches settings`, String(options[key]) === String(settings[key]));
      }
      if (settings.gap !== undefined) check('Native slide spacing matches settings', options.gap === (/^-?[\d.]+$/.test(String(settings.gap)) ? `${settings.gap}px` : String(settings.gap)));
      for (const [key, value] of Object.entries(settings)) {
        if (key.startsWith('perPage:')) {
          const width = breakpointWidths[key.slice('perPage:'.length)];
          check(`Native Splide slide count at ${width}px matches ${key}`, width !== undefined && Number(options.breakpoints?.[width]?.perPage) === Number(value));
        }
      }
      if (!placeholder) check('Native slide child markup exists', classCount(markup, 'splide__slide') === element.children.length);
    }
    if (element.name === 'tabs-nested') {
      if (settings.openTab !== undefined) check('Native initial tab index matches settings', attribute(opening, 'data-open-tab') === String(settings.openTab));
      if (!placeholder) check('Native tab menu, content, titles and panes exist', classCount(markup, 'tab-menu') === 1 && classCount(markup, 'tab-content') === 1 && classCount(markup, 'tab-title') > 0 && classCount(markup, 'tab-pane') === classCount(markup, 'tab-title'));
    }
    if (element.name === 'accordion-nested') {
      if (settings.expandItem !== undefined) check('Native expanded item index matches settings', attribute(opening, 'data-expand-item') === String(settings.expandItem));
      if (settings.transition !== undefined) check('Native accordion transition matches settings', attribute(opening, 'data-transition') === String(settings.transition));
      if (!placeholder) check('Native accordion title and content wrappers exist', classCount(markup, 'accordion-title-wrapper') === element.children.length && classCount(markup, 'accordion-content-wrapper') === element.children.length);
    }
    if (element.name === 'form') {
      check('Native form uses POST', attribute(opening, 'method') === 'post');
      for (const field of settings.fields || []) {
        if (field.type === 'html') continue;
        check(`Native input ${field.id} exists`, markup.includes(`name="form-field-${field.id}"`));
      }
      check('Native submit button exists', /<button\b[^>]*type=["']submit["']/.test(markup));
      if (settings.submitButtonText) check('Submit text matches settings', decode(markup).includes(settings.submitButtonText));
      if (!settings.actions?.length) unverified.push('Form actions are explicitly unconfigured; delivery and submission actions were not tested.');
    }
    results.push({ id: element.id, name: element.name, checks, unverified });
  }
  const failures = results.flatMap(result => result.checks.filter(check => !check.passed).map(check => `${result.name} ${result.id}: ${check.condition}`));
  const unverified = results.flatMap(result => result.unverified.map(message => `${result.name} ${result.id}: ${message}`));
  return { status: failures.length ? 'failed' : unverified.length ? 'partial' : 'backend-markup-passed', checkedComponents: results.length, results, failures, unverified, frontendBehaviorVerified: false, visualQualityVerified: false };
}

export async function nativeIntegration(treeFile, { postId, outDir = path.resolve('.review-work/native-integration'), client } = {}) {
  if (!Number.isInteger(postId) || postId < 1) throw new Error('An existing --page rendering context is required');
  const tree = JSON.parse(fs.readFileSync(treeFile, 'utf8'));
  client ||= await connectReadOnlyBricks();
  const siteContext = await client.call('bricks/list-breakpoints');
  const rendered = await client.call('bricks/render-elements', { postId, elements: tree });
  const report = verifyNativeMarkup(tree, rendered, { breakpoints: siteContext });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'render.json'), JSON.stringify(rendered, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--page');
  if (!args[0] || index < 0) { console.error('Usage: node tools/native-integration.mjs <bricks-tree.json> --page <existing-context-id>'); process.exitCode = 1; }
  else nativeIntegration(args[0], { postId: Number(args[index + 1]) }).then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.failures.length ? 1 : 0; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
