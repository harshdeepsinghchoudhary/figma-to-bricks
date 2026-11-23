import test from 'node:test';
import assert from 'node:assert/strict';
import {repairLoop,integrityFailures} from '../studio/review-worker.js';
import {makeTask} from '../studio/core.js';
import {applyVisualPatches} from '../scripts/visual-patches.js';
test('desktop improvement cannot introduce a new responsive failure',async()=>{
 let restored;
 const result=await repairLoop({initial:{version:0},iterations:2,target:0,
  evaluate:async t=>({score:t.version?.1:.5,integrityFailures:t.version?['390:title:overflow']:[]}),
  suggest:async()=>({issues:[],patches:[1]}),apply:()=>({version:1}),validate:()=>{},restore:async t=>{restored=t;}});
 assert.equal(result.reason,'responsive-regression');assert.equal(restored.version,0);
});
test('integrity identifies broken content at each viewport and ignores hidden elements',()=>{
 const failures=integrityFailures([{width:390,elements:[{id:'hidden-menu',display:'none',x:400,width:200,height:0},{id:'copy',x:0,width:300,height:40,clippedText:true},{id:'photo',x:0,width:300,height:200,brokenImage:true}]}]);
 assert.deepEqual(failures,['390:copy:text-clipping','390:photo:image']);
});
test('bounded repair retains best candidate and stops on regression',async()=>{
 let calls=0;const result=await repairLoop({initial:{error:10},iterations:5,target:0,evaluate:async t=>({score:t.error}),suggest:async()=>({issues:[],patches:[++calls===1?5:8]}),apply:(_,p)=>({error:p[0]}),validate:()=>{}});
 assert.equal(result.bestScore,5);assert.equal(result.tree.error,5);assert.equal(calls,2);assert.equal(result.reason,'no-measurable-improvement');
});
test('repair iteration limit and diagnostic-only mode never silently apply extra changes',async()=>{
 let applies=0;const options={initial:{error:10},target:0,evaluate:async t=>({score:t.error}),suggest:async()=>({issues:[],patches:[1]}),apply:t=>{applies++;return {error:t.error-1}},validate:()=>{}};
 await repairLoop({...options,iterations:0});assert.equal(applies,0);
 await repairLoop({...options,iterations:2});assert.equal(applies,2);
});
test('runtime agent tasks cannot select compiler source write access or unbounded iteration counts',()=>{
 const input={action:'agent',frame:'pgslot-thailand-com-84cdd226',section:'section-16',problem:'Compare FAQ spacing',jobId:'11111111-1111-4111-8111-111111111111',fix:true};
 const task=makeTask(process.cwd(),input,{});assert.ok(task.args[0].endsWith('review-worker.js'));assert.ok(!task.args.includes('workspace-write'));
 assert.throws(()=>makeTask(process.cwd(),{...input,iterations:999},{}),/iterations/);
 assert.throws(()=>makeTask(process.cwd(),{...input,pageUrl:'http://169.254.169.254/'},{WP_API_URL:'https://example.test/wp-json/mcp'}),/configured WordPress/);
 assert.throws(()=>applyVisualPatches([{id:'a',parent:0,name:'section',children:[],settings:{}}],[{op:'settings',id:'a',set:{_cssCustom:'body{display:none}'}}]),/cannot set/);
});
