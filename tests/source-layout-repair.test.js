import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repairSourceLayout } from '../scripts/source-layout-repair.js';
import { reconcileFigmaProperties } from '../scripts/figma-preservation.js';
import { recognizeComponents } from '../scripts/native-components.js';
import { isGraphicNode } from '../scripts/graphic-detect.js';
import { escapeText } from '../scripts/bricks-schema.js';
import { structurePass } from '../scripts/structure-pass.js';
import { responsify } from '../scripts/responsive-pass.js';
import { applyFigmaSettings } from '../scripts/figma-settings.js';

const dir = new URL('../output/pgslot-thailand-com-84cdd226/', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, dir)));
const root = read('figma-node.json'), manifest = read('asset-manifest.json');
const all = n => [n, ...(n.children || []).flatMap(all)];
const source = new Map(all(root).map(n => [n.id, n]));
const normalized = section => read(`sections/section-${section}/normalized.json`);

test('saved AI output recovers all rectangular CTAs with source styles', () => {
  for (const [section, count, text] of [['07',5,'Play Now'], ['11',4,'Claim Now']]) {
    const doc = normalized(section);
    repairSourceLayout(doc, root); reconcileFigmaProperties(doc, root, { manifest });
    const buttons = all(doc).filter(n => n.type === 'button' && n.text === text);
    assert.equal(buttons.length, count);
    for (const b of buttons) { assert.ok(b.background); assert.ok(b.layout.padding.left > 0); assert.ok(!b.children); assert.ok(b.typography.lineHeight); assert.ok(b.layout.margin.top > 0); }
  }
});

test('overlapping artwork survives structural simplification with the original parent and paint order', () => {
  for (const [section, id, count] of [['10','202:137',3], ['13','202:202',2], ['14','202:219',2]]) {
    const manifest = read('asset-manifest.json').filter(a=>a.nodeId!=='202:137');
    const doc = normalized(section); repairSourceLayout(doc, root); reconcileFigmaProperties(doc, root, { manifest });
    const result = structurePass(doc, { figmaRoot: root, manifest }).doc;
    const stack = all(result).find(n => n.figmaNodeId === id);
    assert.equal(stack.children.length, count);
    assert.ok(stack.children.every(c => c.figma.position.mode === 'absolute' && c.figma.parentId === id));
    assert.deepEqual(stack.children.map(c => c.figmaNodeId), source.get(id).children.filter(c=>stack.children.some(n=>n.figmaNodeId===c.id)).map(c=>c.id));
  }
});

test('overflow slider uses native dots, removes embedded dot exports, and does not invent arrows', () => {
  const result = recognizeComponents(normalized('15'), { figmaRoot: root });
  const slider = all(result.doc).find(n => n._nativeName === 'slider-nested');
  assert.ok(slider); assert.equal(slider.children.length, 5);
  assert.equal(slider._nativeSettings.arrows, false); assert.equal(slider._nativeSettings.pagination, true);
  assert.equal(slider._nativeSettings.paginationWidth, '20');
  const options=JSON.parse(slider._nativeSettings.options);
  assert.equal(options.arrows,false); assert.equal(options.height,'auto'); assert.equal(options.gap,'30px');
  assert.match(slider._nativeSettings._cssCustom,/mask-composite: exclude/);
  assert.ok(!all(slider).some(n=>['202:238','202:258','202:277','202:315'].includes(n.asset?.nodeId)));
});

test('a measured sibling pagination strip becomes native slider pagination', () => {
  const box = (x, y, width, height) => ({ x, y, width, height });
  const slideSources = [0, 1, 2].map(i => ({ id: `slide-${i}`, type: 'GROUP', name: `Slide ${i + 1}`, absoluteBoundingBox: box(i * 560, 100, 500, 300) }));
  const dots = [0, 1, 2, 3].map(i => ({ id: `dot-${i}`, type: 'RECTANGLE', name: `Rectangle ${i}`, cornerRadius: 8, absoluteBoundingBox: box(i * 66, 430, 57, 16), fills: [{ type: 'SOLID', color: i === 1 ? { r: 1, g: .4, b: 0 } : { r: .8, g: .8, b: .8 } }] }));
  const figmaRoot = { id: 'root', type: 'FRAME', absoluteBoundingBox: box(0, 0, 1000, 700), children: [{ id: 'slides', type: 'GROUP', name: 'Testimonials', absoluteBoundingBox: box(0, 100, 1620, 300), children: slideSources }, { id: 'dots', type: 'GROUP', name: 'Group 35', absoluteBoundingBox: box(0, 430, 255, 16), children: dots }] };
  const doc = { type: 'page', children: [{ type: 'column', id: 'host', children: [{ type: 'row', id: 'slider', figmaNodeId: 'slides', component: { kind: 'slider' }, children: slideSources.map(s => ({ type: 'column', id: s.id, figmaNodeId: s.id, children: [{ type: 'text', id: `${s.id}-text`, text: s.name }] })) }, { type: 'row', id: 'dots', figmaNodeId: 'dots', children: dots.map(d => ({ type: 'div', id: d.id, figmaNodeId: d.id })) }] }] };
  const result = recognizeComponents(doc, { figmaRoot });
  const slider = all(result.doc).find(n => n._nativeName === 'slider-nested');
  assert.ok(slider); assert.equal(slider._nativeSettings.pagination, true); assert.equal(slider._nativeSettings.arrows, false);
  assert.equal(slider._nativeSettings.paginationWidth, '57');
  assert.ok(!all(result.doc).some(n => n.figmaNodeId === 'dots'));
});

test('phone artwork restores the painted cover and native FAQ retains source details',()=>{
  const manifest = read('asset-manifest.json').filter(a=>a.nodeId!=='202:137');
  const doc=normalized('10');repairSourceLayout(doc,root);reconcileFigmaProperties(doc,root,{manifest});
  const cover=all(doc).find(n=>n.figmaNodeId==='202:141');assert.ok(cover?.background.gradient);assert.equal(cover.figma.position.mode,'absolute');
  const mask=all(doc).find(n=>n.figmaNodeId==='202:143');
  const settings={};
  applyFigmaSettings(mask,settings,{supportedKeys:new Set(['_position','_left','_top','_width','_widthMax','_height']),parentNode:all(doc).find(n=>n.figmaNodeId==='202:137')});
  assert.equal(parseFloat(settings._width),source.get('202:140').absoluteBoundingBox.width);
  assert.equal(parseFloat(settings._left),source.get('202:140').absoluteBoundingBox.x-source.get('202:137').absoluteBoundingBox.x);
  const faq=normalized('16');repairSourceLayout(faq,root);reconcileFigmaProperties(faq,root,{manifest});
  const result=recognizeComponents(faq,{figmaRoot:root}).doc;
  const last=all(result).find(n=>n.figmaNodeId==='202:359');assert.equal(last.background,undefined);assert.match(last.text,/^6\. /);
  const accordion=all(result).find(n=>n._nativeName==='accordion-nested');assert.equal(accordion.children.length,6);
  assert.ok(accordion.children.every(n=>n.children[0].children.some(c=>c.asset)));
});

test('toolbar with icons and separators remains separate artwork', () => {
  assert.equal(isGraphicNode(source.get('250:28')).isGraphic, false);
  assert.equal(isGraphicNode(source.get('250:29')).isGraphic, true);
  assert.equal(isGraphicNode(source.get('250:32')).isGraphic, true);
});

test('decorative phone stack is one export, while text sections and separate images stay editable',()=>{
  const phone=source.get('202:137');
  assert.equal(isGraphicNode(phone).composite,true);
  assert.equal(isGraphicNode(phone).format,'png');
  assert.equal(isGraphicNode(source.get('202:76')).isGraphic,false);
  const separate=structuredClone(phone);
  separate.children[1].absoluteBoundingBox.x+=2000;
  assert.notEqual(isGraphicNode(separate).composite,true);
  const text=structuredClone(phone);text.children.push({id:'editable',type:'TEXT',characters:'Editable'});
  assert.notEqual(isGraphicNode(text).composite,true);
  const doc=normalized('10');repairSourceLayout(doc,root);
  reconcileFigmaProperties(doc,root,{manifest:[...manifest,{nodeId:phone.id,file:'assets/phone.png',type:'image'}]});
  const out=all(doc).find(n=>n.figmaNodeId===phone.id);
  assert.equal(out.type,'image');assert.equal(out.children,undefined);assert.equal(out.asset.nodeId,phone.id);
});

test('header toolbar keeps the measured width and gap instead of spreading across the band', () => {
  const doc = normalized('03'); repairSourceLayout(doc,root); reconcileFigmaProperties(doc,root,{manifest});
  const result = responsify(structurePass(doc,{figmaRoot:root,manifest}).doc,{manifest,siteWidth:1120}).doc;
  const row = all(result).find(n=>n.figmaNodeId==='250:7');
  assert.equal(all(result).find(n=>n.figmaNodeId==='250:28').layout.align,'center');
  assert.equal(row.size.maxWidth,967); assert.equal(row.layout.gap,16);
  assert.equal(row.layout.align,'center');
  assert.notEqual(row.layout.justify,'space-between');
  const nav = all(result).find(n=>n.figmaNodeId==='250:8');
  const line = all(result).find(n=>n.figmaNodeId==='250:10');
  const settings = {_border:{width:{left:'1',right:'1'}}};
  applyFigmaSettings(line,settings,{parentNode:nav,supportedKeys:new Set(['_width','_widthMax','_flexShrink','_margin'])});
  assert.equal(settings._border,undefined);
  assert.equal(parseFloat(settings._width)+parseFloat(settings._margin.left)+parseFloat(settings._margin.right),0);
});

test('footer columns retain their measured widths and source newlines remain line breaks', () => {
  const doc = normalized('17'); repairSourceLayout(doc,root); reconcileFigmaProperties(doc,root,{manifest});
  const result = responsify(structurePass(doc,{figmaRoot:root,manifest}).doc,{manifest,siteWidth:1120}).doc;
  for (const [id,width] of [['202:367',392],['202:370',183],['202:373',297]]) {
    const n=all(result).find(n=>n.figmaNodeId===id); assert.equal(n.size.maxWidth,width);
  }
  assert.equal(escapeText('All (1)\nPgslot game review (15)'), 'All (1)<br>Pgslot game review (15)');
});

test('banking row preserves bottom alignment when converted to a responsive grid', () => {
  const doc = normalized('12'); repairSourceLayout(doc,root); reconcileFigmaProperties(doc,root,{manifest});
  const result = responsify(structurePass(doc,{figmaRoot:root,manifest}).doc,{manifest,siteWidth:1120}).doc;
  const grid = all(result).find(n=>n.layout?.display==='grid');
  assert.ok(grid); assert.equal(grid.layout.align,'end');
});
