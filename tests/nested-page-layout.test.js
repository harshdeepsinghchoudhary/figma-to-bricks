import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSections} from '../scripts/section-detect.js';
import {deterministicNormalize} from '../scripts/figma-preservation.js';
const box=(x,y,width,height)=>({x,y,width,height});
test('nested page wrappers expose bands but clipping and distinct paints remain intact',()=>{
 const bands=[0,1,2].map(i=>({id:`band${i}`,type:'FRAME',absoluteBoundingBox:box(0,i*100,1000,100),children:[{id:`text${i}`,type:'TEXT'}]}));
 const body={id:'body',type:'FRAME',absoluteBoundingBox:box(0,0,1000,100),children:bands};
 const root={id:'root',absoluteBoundingBox:box(0,0,1000,300),children:[body]};
 assert.deepEqual(pageSections(root),bands);
 body.clipsContent=true;assert.deepEqual(pageSections(root),[body]);
 body.clipsContent=false;body.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];assert.deepEqual(pageSections(root),[body]);
});
test('centered intrinsic labels use alignment instead of hundreds of pixels of padding',()=>{
 const label={id:'label',type:'TEXT',characters:'Our services',absoluteBoundingBox:box(450,0,100,30),style:{textAutoResize:'WIDTH_AND_HEIGHT',fontSize:20}};
 const root={id:'root',type:'FRAME',absoluteBoundingBox:box(0,0,1000,30),children:[label]};
 const {doc}=deterministicNormalize(root);
 const nodes=[];(function walk(n){nodes.push(n);for(const c of n.children||[])walk(c);})(doc);
 const wrapper=nodes.find(n=>n.figmaNodeId==='root');
 assert.equal(wrapper.layout.padding.left,0);assert.equal(wrapper.layout.padding.right,0);assert.equal(wrapper.layout.align,'center');
});
