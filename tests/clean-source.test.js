import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourceMenuContext} from '../scripts/source-menu-context.js';
import {repairSourceFaq} from '../scripts/source-faq.js';
import {inferSiteWidth} from '../scripts/site-width.js';
import {deterministicNormalize} from '../scripts/figma-preservation.js';
test('overlapping unpainted footer groups become flowing columns, not a pinned canvas',()=>{
 const root=JSON.parse(fs.readFileSync('output/match-plus-home/figma-node.json'));
 const footer=root.children.find(n=>n.id==='32:2611');
 const manifest=JSON.parse(fs.readFileSync('output/match-plus-home/asset-manifest.json'));
 const result=deterministicNormalize(footer,manifest,{frameWidth:1728,siteWidth:1276}).doc.children[0];
 assert.notEqual(result.figma?.geometryPositioned,true);
 assert.ok(result.children.some(n=>n.type==='row'));
});
test('repeated portfolio card panels keep their equal measured width',()=>{
 const root=JSON.parse(fs.readFileSync('output/landing-page/figma-node.json'));
 let cards; (function walk(n){if(n.id==='645:469')cards=n;for(const c of n.children||[])walk(c);})(root);
 const manifest=JSON.parse(fs.readFileSync('output/landing-page/asset-manifest.json'));
 const result=deterministicNormalize(cards,manifest,{frameWidth:1920,siteWidth:1413}).doc.children[0];
 const panels=result.children.filter(n=>n.background?.color);
 assert.equal(panels.length,4);assert.ok(panels.every(n=>n.size.width===330));
});
test('site width does not select a repeated half-width column',()=>{
 const read=name=>JSON.parse(fs.readFileSync(`output/${name}/figma-node.json`));
 assert.equal(inferSiteWidth(read('match-plus-home')),1276);
 assert.equal(inferSiteWidth(read('pgslot-thailand-com-84cdd226')),1120);
});
test('PG Slot hamburger, menu and footer context are derived without saved bindings',()=>{
 const root=JSON.parse(fs.readFileSync('output/pgslot-thailand-com-84cdd226/figma-node.json'));
 const result=sourceMenuContext(root);
 assert.equal(result.controls.length,1);assert.equal(result.controls[0].trigger,'202:22');
 assert.equal(result.controls[0].navigation,'250:8');assert.ok(result.footerIds.has('202:364'));
});
test('all active design headers expose their source navigation row',()=>{
 for(const [folder,id] of [['jilislot-global-0d6791f8','8219:33'],['jilislot-global-v-2','8232:8'],['match-plus-home-07978f5e','32:2599'],['pgslot-thailand-com-84cdd226','250:8'],['landing-page','260:137']]){
  const root=JSON.parse(fs.readFileSync(`output/${folder}/figma-node.json`));
  assert.ok(sourceMenuContext(root).navIds.has(id),`${folder} navigation ${id}`);
 }
});
test('FAQ source rows become six editable items without inventing five answers',()=>{
 const questions=Array.from({length:6},(_,i)=>({type:'row',id:'r'+i,children:[{type:'text',id:'q'+i,text:`Question ${i}?`,figma:{absoluteBoundingBox:{y:i*100}}}]}));
 const answer={type:'text',id:'answer',text:'Source answer',figma:{absoluteBoundingBox:{y:550}}};
 const doc={type:'column',id:'faq-section',children:[{type:'heading',id:'h',text:'FAQ'},...questions,answer]};
 repairSourceFaq(doc);const faq=doc.children[1];assert.equal(faq.component.kind,'accordion');assert.equal(faq.children.length,6);
 assert.equal(faq.component.options.openIndex,5);assert.equal(faq.children[0].children[1].children.length,0);assert.equal(faq.children[5].children[1].children[0].text,'Source answer');
});
