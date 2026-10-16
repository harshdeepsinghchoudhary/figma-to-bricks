import test from 'node:test';
import assert from 'node:assert/strict';
import {responsify} from '../scripts/responsive-pass.js';
import {capTabletPadding} from '../scripts/responsive-padding.js';
test('large measured row gap becomes fluid space-between without losing its desktop span',()=>{
 const doc={type:'page',children:[{type:'section',id:'section',children:[{type:'row',id:'wide',layout:{direction:'row',gap:160},children:[{type:'image',id:'a',figmaNodeId:'a',size:{width:300,height:200}},{type:'image',id:'b',figmaNodeId:'b',size:{width:200,height:200}}]}]}]};
 const geo={a:{x:0,y:0,width:300,height:200},b:{x:460,y:0,width:200,height:200}};
 const out=responsify(doc,{geo,siteWidth:1120}).doc;
 const all=n=>[n,...(n.children||[]).flatMap(all)];const row=all(out).find(n=>n.id==='wide');
 assert.equal(row.size.width,'fill');assert.equal(row.size.maxWidth,660);assert.equal(row.layout.justify,'space-between');assert.equal(row.layout.gap,20);
});
test('tablet side padding cap preserves small values and vertical padding',()=>{
 const tree=[{id:'a',settings:{_padding:{left:'96px',right:'16',top:'100'},'_padding:mobile_portrait':{left:'10',right:'30'}}}];
 capTabletPadding(tree);const s=tree[0].settings;
 assert.equal(s._padding.left,'96px');assert.equal(s._padding.top,'100');
 assert.match(s._cssCustom,/@media\(max-width:1024px\).*padding-left:20px/);
 assert.match(s._cssCustom,/padding-right:16px/);
 assert.match(s._cssCustom,/padding-left:10px/);
 assert.equal(s['_padding:mobile_portrait'].right,'20');
});
