import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {runRootCauseReview,parseRootCauseProposal} from '../studio/root-cause-review.js';
import {compileRootCandidate,runCompilerScript,spliceSection} from '../studio/root-cause-candidate.js';
import {applyNormalizedRepairs} from '../studio/normalized-repair.js';
import {capture} from '../studio/visual.js';

test('root cause response rejects executable envelopes and arbitrary extra fields',()=>{
 assert.throws(()=>parseRootCauseProposal('{"issues":[],"patches":[],"shell":"echo bad"}'));
 assert.deepEqual(parseRootCauseProposal('{"issues":[],"patches":[]}').ruleProposals,[]);
});
test('section replacement preserves unrelated accepted settings and rejects collisions',()=>{
 const before=[{id:'old',parent:0,children:[]},{id:'keep',parent:0,children:[],settings:{_padding:{top:'42'}}}];
 const result=spliceSection(before,[{id:'next',parent:0,children:[]},{id:'keep',settings:{}}],{rootIds:['old']},{rootIds:['next']});
 assert.deepEqual(result[1],before[1]);assert.notEqual(result[1],before[1]);
 assert.throws(()=>spliceSection(before,[{id:'keep',parent:0,children:[]}],{rootIds:['old']},{rootIds:['keep']}),/collides/);
});
test('root repair restores source text through real compilation and browser screenshots in isolation',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'root-repair-')),frame=path.join(temp,'frame'),sectionDir=path.join(frame,'sections','section-01'),merged=path.join(frame,'merged');
 fs.mkdirSync(sectionDir,{recursive:true});
 const box=(x,y,width,height)=>({x,y,width,height});
 const raw={id:'1:0',type:'FRAME',absoluteBoundingBox:box(0,0,600,200),children:[{id:'1:1',type:'FRAME',absoluteBoundingBox:box(0,0,600,200),children:[{id:'1:2',type:'TEXT',characters:'Recovered title',absoluteBoundingBox:box(20,30,300,40),style:{fontFamily:'Arial',fontSize:28,fontWeight:700},fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]},{id:'1:3',type:'TEXT',characters:'Existing editable copy',absoluteBoundingBox:box(20,85,300,30),style:{fontFamily:'Arial',fontSize:18,fontWeight:400},fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]}]}]};
 const normalized={type:'page',children:[{id:'section',type:'section',figmaNodeId:'1:1',layout:{padding:{top:30,bottom:30}},size:{height:200},children:[{id:'body',type:'text',figmaNodeId:'1:3',text:'Existing editable copy'}]}]};
 const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const patch={op:'restore',id:'title',sourceId:'1:2',parentId:'section',index:0};
 try{
  write(path.join(frame,'figma-node.json'),raw);write(path.join(frame,'sections.json'),{'1:1':'section-01'});write(path.join(frame,'asset-manifest.json'),[]);write(path.join(sectionDir,'normalized.json'),normalized);
  await runCompilerScript('3_compile_bricks.js',[sectionDir]);await runCompilerScript('merge_sections.js',[frame,'section-01']);
  const best={tree:read(path.join(merged,'bricks-tree.json')),sourceMap:read(path.join(merged,'bricks-source-map.json')),sectionMap:read(path.join(merged,'section-map.json')),normalized};
  write(path.join(merged,'bricks-template-import.json'),{content:best.tree});
  const corrected=applyNormalizedRepairs(normalized,[patch],{rawRoot:raw,sectionSourceId:'1:1'});
  const expected=await compileRootCandidate({frame,dir:path.join(temp,'expected'),section:best.sectionMap[0],normalized:corrected,best,treeDir:merged});
  const expectedDir=path.join(temp,'reference');await capture(expected.tree,merged,expectedDir,[600]);
  await sharp(path.join(expectedDir,'600.png')).extract({left:0,top:0,width:600,height:200}).toFile(path.join(frame,'screenshot.png'));
  const sourceBytes=fs.readFileSync(path.join(sectionDir,'normalized.json'),'utf8'),rawBytes=fs.readFileSync(path.join(frame,'figma-node.json'),'utf8');
  let requests=0,compiles=0;
  const outDir=path.join(temp,'review');
  const result=await runRootCauseReview({frame,outDir,section:'section-01',repairMode:'root-cause',engine:'codex',iterations:1,target:.001,fix:true,widths:[390],problem:'Restore source content'}, {
   request:async()=>{requests++;return {issues:requests===1?[{severity:'high',description:'Source title is missing'}]:[],patches:requests===1?[patch]:[],ruleProposals:requests===1?[{title:'Preserve source labels',evidence:'Visible text absent from normalization',suggestedRule:'Recover source-mapped text before compilation',regressionCases:['Visible text missing','Do not duplicate button labels']}]:[]};},
   compileCandidate:async args=>{compiles++;return compileRootCandidate(args);}
  });
  assert.equal(compiles,1);assert.equal(requests,2);assert.ok(result.tree.some(e=>String(e.settings?.text).includes('Recovered title')));
  assert.equal(fs.readFileSync(path.join(sectionDir,'normalized.json'),'utf8'),sourceBytes);assert.equal(fs.readFileSync(path.join(frame,'figma-node.json'),'utf8'),rawBytes);
  assert.ok(fs.existsSync(path.join(outDir,'0','root-causes.json')));assert.ok(fs.existsSync(path.join(outDir,'1','390.png')));
  const report=read(path.join(outDir,'report.json'));assert.equal(report.frontendVerified,false);assert.equal(report.renderer,'local approximation');
  assert.equal(read(path.join(outDir,'compiler-rule-proposals.json'))[0].status,'requires-development-review');
  assert.ok(result.history[0].candidate.score<result.history[0].score);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
