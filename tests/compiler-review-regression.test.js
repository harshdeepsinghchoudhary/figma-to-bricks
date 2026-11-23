import test from 'node:test';
import assert from 'node:assert/strict';
import {repairSourceLayout} from '../scripts/source-layout-repair.js';
import {responsify} from '../scripts/responsive-pass.js';
import {allowedPreviewResource} from '../studio/visual.js';
import {repairLoop} from '../studio/review-worker.js';
import {compactReviewContext} from '../studio/section-evidence.js';
import {responsiveContent} from '../scripts/responsive-content.js';
import {capTabletPadding} from '../scripts/responsive-padding.js';
import {reconcileFigmaProperties} from '../scripts/figma-preservation.js';
import {buildBricksElement} from '../scripts/bricks-schema.js';
test('native slider track cannot set the minimum width of its flex parent',()=>{
 const tree=[{id:'slider',name:'slider-nested',children:['slide'],settings:{}},{id:'slide',name:'block',parent:'slider',settings:{_width:'1120px'}}];responsiveContent(tree);
 assert.deepEqual(tree[0].settings,{_width:'100%',_widthMax:'100%',_widthMin:'0'});
 assert.equal(tree[1].settings._widthMax,'100%');assert.equal(tree[1].settings._width,'1120px');
});
test('source-only photo keeps its gradient overlay without replacing the image',()=>{
 const source={id:'panel',type:'FRAME',absoluteBoundingBox:{x:0,y:0,width:800,height:420},fills:[{type:'IMAGE'},{type:'GRADIENT_LINEAR',gradientHandlePositions:[{x:.5,y:1},{x:.5,y:0},{x:1.5,y:1}],gradientStops:[{position:0,color:{r:0,g:0,b:0,a:.75}},{position:1,color:{r:0,g:0,b:0,a:0}}]}],children:[]};
 const doc={id:'panel',type:'block',figmaNodeId:'panel',children:[{id:'text',type:'text',text:'Editable caption'}]};
 reconcileFigmaProperties(doc,source,{manifest:[{nodeId:'panel:image-fill',exportMode:'source-image'}]});
 assert.ok(doc._overlay);assert.equal(doc.background?.gradient,undefined);
 const element=buildBricksElement('block',doc);
 assert.match(element.settings._cssCustom,/::before/);assert.match(element.settings._cssCustom,/pointer-events: none/);
 assert.equal(doc.children[0]._raise,true);assert.equal(doc.children[0].text,'Editable caption');
});
test('edge-to-edge image panels are not constrained to the site text width',()=>{
 const box=(x,width)=>({x,y:0,width,height:420});
 const panels=[0,1].map(i=>({id:`panel${i}`,type:'FRAME',absoluteBoundingBox:box(i*800,800),fills:[{type:'IMAGE'}],children:[{id:`text${i}`,type:'TEXT',characters:'Caption',absoluteBoundingBox:{x:i*800+32,y:300,width:300,height:30}}]}));
 const source={id:'section',type:'FRAME',absoluteBoundingBox:box(0,1600),children:panels};
 const doc={type:'page',children:[{id:'section',type:'section',figmaNodeId:'section',layout:{direction:'row'},children:panels.map(p=>({id:p.id,figmaNodeId:p.id,type:'column',size:{width:800},children:[{id:p.children[0].id,type:'text',text:'Caption',figmaNodeId:p.children[0].id}]}))}]};
 repairSourceLayout(doc,source);const result=responsify(doc,{siteWidth:1200}).doc.children[0];
 assert.equal(result.children[0].size.maxWidth,'100%');assert.equal(result.layout.padding.left,0);assert.equal(result.layout.padding.right,0);
 // A gap in the source means these are ordinary contained cards.
 source.children[1].absoluteBoundingBox.x+=20;
 const other=structuredClone(doc);delete other.children[0]._fullBleedContent;delete other.children[0]._sourceContainerWidth;
 repairSourceLayout(other,source);assert.equal(other.children[0]._fullBleedContent,undefined);
});

test('padding cap emits one rule when smaller breakpoints repeat the same value',()=>{
 const tree=[{id:'box',settings:{_padding:{left:'40',right:'40'}}}];capTabletPadding(tree);
 assert.equal(tree[0].settings._cssCustom.match(/@media/g).length,1);
});
test('header grouping preserves logo and menu together with actions as a sibling',()=>{
 const tree=[{id:'header',children:['row'],settings:{}},{id:'row',parent:'header',children:['logo','menu','actions'],settings:{_width:'100%'}},{id:'logo',parent:'row',settings:{}},{id:'menu',name:'nav-menu',parent:'row',settings:{_width:'100%'}},{id:'actions',parent:'row',children:[],settings:{_margin:{left:'200'}}}];
 responsiveContent(tree,{header:{figmaNodeId:'source'}},{id:'source',name:'Header'});
 assert.deepEqual(tree[0].children,['row','actions']);assert.deepEqual(tree[1].children,['logo','menu']);assert.equal(tree[4].parent,'header');assert.equal(tree[4].settings._margin,undefined);
});

test('responsive pinned layers keep percentage dimensions unchanged',()=>{
 const tree=[{id:'parent',children:['overlay'],settings:{}},{id:'overlay',parent:'parent',settings:{_position:'absolute',_left:'0',_width:'100%',_height:'100%'}}];
 responsiveContent(tree,{parent:{figmaNodeId:'raw'}},{id:'raw',absoluteBoundingBox:{width:1600}});
 assert.equal(tree[1].settings._cssCustom,undefined);
});
test('nested feature copy stays beside its icon and large headings scale on mobile',()=>{
 const doc={type:'page',children:[{id:'section',type:'section',children:[{id:'feature',type:'row',layout:{direction:'row',gap:12},children:[{id:'icon',type:'icon',size:{width:44}},{id:'copy',type:'column',children:[{id:'heading',type:'heading',text:'Title',typography:{fontSize:48}}]}]}]}]};
 const result=responsify(doc).doc;const all=[];(function walk(n){all.push(n);for(const c of n.children||[])walk(c)})(result);
 assert.equal(all.find(n=>n.id==='feature').responsive.tablet_portrait.layout.direction,'row');
 assert.equal(all.find(n=>n.id==='heading').responsive.mobile_landscape.typography.fontSize,32);
});

test('capture permits public font resources without permitting external documents or scripts',()=>{
 assert.equal(allowedPreviewResource('https://fonts.googleapis.com/css2?family=Inter','stylesheet','https://example.com'),true);
 assert.equal(allowedPreviewResource('https://fonts.gstatic.com/s/inter/font.woff2','font','https://example.com'),true);
 for(const [url,type] of [['https://fonts.googleapis.com/','document'],['https://fonts.gstatic.com/a.js','script'],['http://127.0.0.1/private','font'],['https://fonts.gstatic.com.evil.com/a','font']])assert.equal(allowedPreviewResource(url,type,'https://example.com'),false);
});
test('synthetic section does not constrain a full-width source section twice',()=>{
 const box={x:0,y:0,width:1600,height:150};
 const inner={id:'inner',type:'FRAME',absoluteBoundingBox:{x:160,y:40,width:1280,height:70},children:[{id:'label',type:'TEXT',characters:'content'}]};
 const section={id:'section',type:'FRAME',absoluteBoundingBox:box,children:[inner]};
 const root={id:'root',absoluteBoundingBox:{...box,height:1000},children:[section]};
 const doc={type:'page',children:[{id:'scope',type:'section',figmaNodeId:'scope',children:[{id:'source',figmaNodeId:'section',type:'column',size:{height:150},children:[{id:'content',figmaNodeId:'inner',type:'column',children:[{id:'text',type:'text',text:'content'}]}]}]}]};
 repairSourceLayout(doc,root);assert.equal(doc.children[0].figmaNodeId,'section');assert.equal(doc.children[0]._sourceContainerWidth,1280);
 const result=responsify(doc,{siteWidth:1232}).doc.children[0];assert.equal(result.children[0].size.maxWidth,1280);assert.equal(result.size.height,undefined);assert.equal(result.size.minHeight,150);
});
test('review context retains paint evidence without asset payloads',()=>{
 const c=compactReviewContext([{settings:{_background:{color:{raw:'#123456'},image:{url:'secret'}},_cssCustom:'large'}}],[],[]);
 assert.deepEqual(c.elements[0].settings,{_background:{color:{raw:'#123456'}}});
});
test('review budget exhaustion is distinct from no proposed improvement',async()=>{
 const r=await repairLoop({initial:[],iterations:2,target:.08,evaluate:async()=>({score:.3}),suggest:async()=>({issues:[{severity:'high'}],patches:[],stopReason:'review-budget'}),validate:()=>{},apply:()=>[]});
 assert.equal(r.reason,'review-budget');assert.equal(r.history.length,1);
});
