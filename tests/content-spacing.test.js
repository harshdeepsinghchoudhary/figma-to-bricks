import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {repairContentSpacing} from '../scripts/content-spacing.js';
test('all four bonus card wrappers expand on tablet and align headings with left-aligned copy',()=>{
 const {tree,sourceMap}=JSON.parse(fs.readFileSync('output/pgslot-thailand-com-84cdd226/merged/menu-source.json','utf8'));
 const buttons=tree.filter(e=>e.name==='button'&&e.settings.text==='Claim Now');
 assert.equal(buttons.length,4);
 const original=buttons.map(b=>tree.find(e=>e.id===b.parent)).map(b=>b.settings._widthMax);
 repairContentSpacing(tree,sourceMap);
 for(const [i,button] of buttons.entries()){
  const body=tree.find(e=>e.id===button.parent),heading=tree.find(e=>e.parent===body.id&&e.name==='heading');
  assert.equal(body.settings._widthMax,original[i]);
  assert.equal(body.settings['_widthMax:tablet_portrait'],'100%');
  assert.equal(body.settings['_padding:tablet_portrait'].left,'20');
  assert.match(body.settings._cssCustom,/max-width:1024px/);
  assert.ok(body.settings._cssCustom.includes(`#brxe-${heading.id}`));
  assert.equal(heading.settings._typography['text-align'],'left');
 }
});
test('card body owns shared inset without adding image padding or double bottom spacing',()=>{
 const tree=[{id:'outer',children:['card'],settings:{_padding:{bottom:'24'}}},{id:'card',parent:'outer',children:['img','title','copy'],settings:{}},{id:'img',name:'image',settings:{}},{id:'title',name:'heading',settings:{_margin:{left:'24',top:'24'}}},{id:'copy',name:'text',settings:{_margin:{left:'24',top:'14'}}}];
 repairContentSpacing(tree);const body=tree.at(-1);
 assert.deepEqual(body.settings._padding,{top:'24',right:'24',bottom:'24',left:'24'});
 assert.equal(tree[0].settings._padding.bottom,'0');assert.equal(tree[3].settings._margin.left,undefined);assert.equal(tree[4].settings._margin.top,'14');assert.equal(tree[1].children[0],'img');
});
test('native title rows get measured fluid width and lose their fixed large gap',()=>{
 const tree=[{id:'row',name:'block',children:['a','b'],settings:{_direction:'row',_columnGap:'490'}},{id:'a',settings:{}},{id:'b',settings:{}}];
 const root={id:'row',absoluteBoundingBox:{x:0,y:0,width:875,height:34},children:[{id:'a',absoluteBoundingBox:{x:0,y:0,width:351,height:34}},{id:'b',absoluteBoundingBox:{x:841,y:0,width:34,height:34}}]};
 repairContentSpacing(tree,Object.fromEntries(['row','a','b'].map(id=>[id,{figmaNodeId:id}])),root);
 assert.equal(tree[0].settings._columnGap,'20');assert.equal(tree[0].settings._widthMax,'875px');assert.equal(tree[0].settings._width,'100%');
});
