import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {autopilot} from '../studio/autopilot-worker.js';
import {makeTask} from '../studio/core.js';

test('one-click validates credentials and keeps user page IDs out of its worker',()=>{
 const input={action:'autopilot',url:'https://www.figma.com/design/test?node-id=1-2',jobId:'11111111-1111-4111-8111-111111111111',pageId:123};
 assert.throws(()=>makeTask(process.cwd(),input,{}),/FIGMA_TOKEN/);
 const env={FIGMA_TOKEN:'fixture',WP_API_URL:'https://example.test/wp-json/mcp',WP_API_USERNAME:'fixture',WP_API_PASSWORD:'fixture',CODEX_API_KEY:'fixture'};
 const task=makeTask(process.cwd(),input,env);assert.match(task.args[0],/autopilot-worker/);assert.ok(!task.stdin.includes('123'));assert.ok(!task.stdin.includes('fixture'));
 assert.equal(JSON.parse(task.stdin).repairMode,'settings');
 assert.equal(JSON.parse(makeTask(process.cwd(),{...input,repairMode:'root-cause'},env).stdin).repairMode,'root-cause');
 assert.throws(()=>makeTask(process.cwd(),{...input,repairMode:'unrestricted'},env),/repair/);
 assert.throws(()=>makeTask(process.cwd(),{...input,iterations:3},env),/repair rounds/);
});

test('one-click sends retained corrections to a new draft and preserves shared source',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-autopilot-')),frame=path.join(root,'output','fixture'),merged=path.join(frame,'merged'),outDir=path.join(root,'.studio','artifacts','job');
 fs.mkdirSync(merged,{recursive:true});
 fs.mkdirSync(path.join(frame,'sections','section-01'),{recursive:true});
 fs.writeFileSync(path.join(frame,'sections','section-01','normalized.json'),JSON.stringify({id:'original'}));
 const tree=[{id:'abcdef',name:'section',parent:0,children:[],settings:{}}];
 const write=(name,value)=>fs.writeFileSync(path.join(merged,name),JSON.stringify(value));
 fs.writeFileSync(path.join(frame,'figma-node.json'),'{}');write('bricks-tree.json',tree);write('bricks-template-import.json',{content:tree});write('section-map.json',[{name:'section-01'},{name:'section-02'}]);
 let injected=false,reviews=0,updates=0,finals=0;
 const run=async(script,args)=>{
  if(script==='pipeline.js'){assert.ok(args.includes('--no-inject'));assert.ok(args.includes('--provider'));assert.ok(!args.includes('--deterministic'));return `Frame folder: ${frame}`;}
  if(script==='4_inject_mcp.js'){
   injected=true;if(args.includes('--page')){assert.equal(args[args.indexOf('--page')+1],'42');updates++;}
   const result=JSON.parse(fs.readFileSync(path.join(args[0],'bricks-tree.json')));if(args.includes('--page'))assert.ok(['25','26'].includes(result[0].settings._padding.top));
   fs.writeFileSync(path.join(args[0],'inject-report.json'),JSON.stringify({postId:42,created:true,permalink:'https://example.test/?page_id=42'}));
  }
  return '';
 };
 const review=async (input,{deploy})=>{
  assert.equal(input.pageUrl,'https://example.test/?page_id=42');
  assert.equal(input.repairMode,'root-cause');
  if(!input.fix){finals++;return {tree:[],reason:'target',bestScore:.01};}
  const candidate=JSON.parse(fs.readFileSync(path.join(input.frame,'merged','bricks-tree.json')));reviews++;
  if(reviews===2)assert.equal(candidate[0].settings._padding.top,'25');
  candidate[0].settings._padding={top:String(24+reviews)};await deploy(candidate);
  fs.mkdirSync(input.outDir,{recursive:true});fs.writeFileSync(path.join(input.outDir,'bricks-template-import.json'),JSON.stringify({content:candidate}));
  return {tree:candidate,reason:'iteration-limit',bestScore:.1,...(reviews===1?{normalizedSection:{id:'corrected'},sourceMap:{abcdef:{figmaNodeId:'1:2'}},sectionMap:[{name:'section-01',rootIds:['abcdef']},{name:'section-02'}]}:{})};
 };
 try{
  const result=await autopilot({source:['fixture-url'],outDir,iterations:1,repairMode:'root-cause'},{root,run,review});
  assert.equal(reviews,2);assert.equal(injected,true);assert.equal(result.frontendVerified,false);assert.equal(finals,2);assert.equal(updates,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(merged,'bricks-tree.json'))),tree);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(frame,'sections','section-01','normalized.json'))),{id:'original'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir,'work','fixture','sections','section-01','normalized.json'))),{id:'corrected'});
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir,'workflow.json'))).repairMode,'root-cause');
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir,'checkpoints','section-01.json'))).repairMode,'root-cause');
  injected=false;await assert.rejects(autopilot({source:['fixture-url'],outDir:path.join(root,'.studio','failed')},{root,run,review:async()=>{throw Error('model failed')}}),/model failed/);assert.equal(injected,true);const report=JSON.parse(fs.readFileSync(path.join(root,'.studio','failed','workflow.json')));assert.equal(report.status,'verification-blocked');assert.equal(report.injection.postId,42);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
