import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resumeVerification} from '../studio/resume-verification.js';
test('verification retry reuses the recorded draft, copies artifacts, and rejects a different site',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'resume-test-')),priorId='11111111-1111-4111-8111-111111111111';
 const prior=path.join(root,'.studio/artifacts',priorId),frame=path.join(prior,'work/design'),outDir=path.join(root,'new-job');
 const previous=process.env.WP_API_URL;process.env.WP_API_URL='https://site.test/wp-json/mcp';
 try{
  fs.mkdirSync(path.join(frame,'merged'),{recursive:true});fs.writeFileSync(path.join(frame,'figma-node.json'),'{}');
  fs.writeFileSync(path.join(frame,'merged/section-map.json'),'[]');
  fs.writeFileSync(path.join(prior,'workflow.json'),JSON.stringify({repairMode:'root-cause',injection:{postId:4771,permalink:'https://site.test/?page_id=4771'}}));
  let called=false;await resumeVerification({priorId,outDir},root,async context=>{called=true;assert.equal(context.injection.postId,4771);assert.equal(context.input.repairMode,'root-cause');assert.ok(context.frame.startsWith(outDir));});assert.ok(called);
  fs.writeFileSync(path.join(frame,'merged/section-map.json'),JSON.stringify([{name:'section-02'}]));
  const calls=[];await resumeVerification({priorId,outDir},root,async context=>assert.equal(context.injection.postId,4771),async(script,args)=>{calls.push({script,args});});
  assert.deepEqual(calls.map(c=>c.script),['3_compile_bricks.js','merge_sections.js','wrap-template.js','conversion-audit.js','4_inject_mcp.js']);
  assert.ok(calls.at(-1).args.includes('4771'));assert.ok(calls.at(-1).args.includes('--page'));
  process.env.WP_API_URL='https://different.test/wp-json/mcp';await assert.rejects(resumeVerification({priorId,outDir},root),/currently configured website/);
 }finally{if(previous===undefined)delete process.env.WP_API_URL;else process.env.WP_API_URL=previous;fs.rmSync(root,{recursive:true,force:true});}
});
