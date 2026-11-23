import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedProposal} from '../studio/validated-proposal.js';
import {applyVisualPatches} from '../scripts/visual-patches.js';
const tree=[{id:'abcdef',name:'section',parent:0,children:[],settings:{}}];
const invalid={issues:[],patches:[{op:'settings',id:'abcdef',set:{_cssCustom:'body{display:none}'}}]};
test('forbidden CSS is rejected before application and one corrected native proposal is accepted',async()=>{
 let calls=0;const events=[];
 const result=await validatedProposal({request:async feedback=>{calls++;if(calls===1)return invalid;assert.match(feedback,/_cssCustom/);return {issues:[],patches:[{op:'settings',id:'abcdef',set:{_padding:{top:'24'}}}]};},validate:p=>applyVisualPatches(tree,p.patches),event:e=>events.push(e)});
 assert.equal(calls,2);assert.equal(events.length,1);assert.equal(result.patches[0].set._padding.top,'24');assert.deepEqual(tree[0].settings,{});
});
test('repeated invalid proposals become an unresolved issue without relaxing validation or looping',async()=>{
 let calls=0;const result=await validatedProposal({request:async()=>{calls++;return invalid;},validate:p=>applyVisualPatches(tree,p.patches)});
 assert.equal(calls,2);assert.deepEqual(result.patches,[]);assert.equal(result.issues[0].severity,'high');assert.match(result.rejectedReason,/_cssCustom/);
});
