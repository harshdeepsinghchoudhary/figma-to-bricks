import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {runReview} from './review-worker.js';
import {framePath,repairMode} from './core.js';
import {agentProvider} from './providers.js';
import {reviewBudget} from './usage.js';
import {sectionFingerprint} from './review-checkpoint.js';
import {validateBuild} from '../scripts/validate-build.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export const COMPILER_REVISION='2026-10-29-responsive-2';
export function runScript(root,script,args){
 return new Promise((resolve,reject)=>{
  let output='';const child=spawn(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root,env:process.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=d=>{output=(output+d.toString()).slice(-2000000);process.stdout.write(d)};
  child.stdout.on('data',log);child.stderr.on('data',log);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(`${script} failed (${code}). Draft creation stopped.`)));
 });
}
export async function autopilot(input,{root=process.cwd(),run=(s,a)=>runScript(root,s,a),review=runReview}={}){
 input={...input,repairMode:repairMode(input.repairMode)};
 fs.mkdirSync(input.outDir,{recursive:true});
 process.env.STUDIO_USAGE_FILE=path.join(input.outDir,'usage.json');
 const emit=(stage,extra={})=>console.log(JSON.stringify({event:stage,stage,...extra}));
 emit('check-wordpress-browser-access');
 await run('check-draft-access.js',[path.join(input.outDir,'access-preflight')]);
 if(process.env.STUDIO_HOSTED==='1'){emit('sync-your-bricks-schema');await run('sync-bricks-schema.js',[]);}
 emit('extract-and-compile');
 const provider=agentProvider(process.env);
 if(process.env.STUDIO_AGENT_MODEL)process.env[provider.id==='codex'?'CODEX_MODEL':provider.id.toUpperCase()+'_MODEL']=process.env.STUDIO_AGENT_MODEL;
 const output=await run('pipeline.js',[...input.source,'--provider',agentProvider(process.env).id,'--force','--no-inject','--no-visual','--no-dataset']);
 const match=output.match(/Frame folder: (.+)/);if(!match)throw Error('Compiler did not identify its frame.');
 const source=framePath(root,path.basename(match[1].trim()));
 // All binding and repair mutations occur in this job-owned copy.
 const frame=path.join(input.outDir,'work',path.basename(source));
 fs.cpSync(source,frame,{recursive:true,filter:p=>!['runs','.git'].includes(path.basename(p))});
 const merged=path.join(frame,'merged'),sections=read(path.join(merged,'section-map.json'));
 if(!sections.length||sections.length>40)throw Error('One-click review requires 1–40 compiled sections. Split larger frames.');
 emit('prepare-wordpress-menus');await run('setup-pipeline-menus.js',[frame]);
 await run('merge_sections.js',[frame,...sections.map(s=>s.name)]);
 await run('wrap-template.js',[merged,`${path.basename(source)} page`]);
 emit('audit-before-import');await run('conversion-audit.js',[frame]);
 if(fs.existsSync(path.join(merged,'conversion-audit.json')))fs.copyFileSync(path.join(merged,'conversion-audit.json'),path.join(input.outDir,'conversion-audit.json'));
 emit('create-wordpress-draft');
 await run('4_inject_mcp.js',[merged,'--fix-keys','--title',`Studio - ${path.basename(source)}`,'--report-dir',path.join(input.outDir,'mcp')]);
 const injection=read(path.join(merged,'inject-report.json'));
 if(!Number.isInteger(injection.postId)||injection.created!==true)throw Error('Expected a new job-owned draft.');
 return verifyDraft({input,frame,merged,sections,injection},{run,review});
}
export async function verifyDraft({input,frame,merged,sections,injection},{run,review=runReview}){
 input={...input,repairMode:repairMode(input.repairMode)};
 const emit=(stage,extra={})=>console.log(JSON.stringify({event:stage,stage,...extra}));
 process.env.STUDIO_USAGE_FILE=path.join(input.outDir,'usage.json');
 const reviews=[];
 const budget=reviewBudget(path.join(input.outDir,'usage.json'),input.reviewCalls??8);
 const captureCache=new Map();
 const workflowFile=path.join(input.outDir,'workflow.json');
 const save=value=>fs.writeFileSync(workflowFile,JSON.stringify({...value,compilerRevision:COMPILER_REVISION,repairMode:input.repairMode},null,2));
 if(!Number.isInteger(injection.postId)||injection.postId<1||!injection.permalink)throw Error('Missing draft injection identity.');
 let lastDeployed=JSON.stringify(read(path.join(merged,'bricks-tree.json')));
 const deploy=async tree=>{
  const valid=validateBuild(tree,merged);if(valid.errors.length)throw Error(valid.errors.join('; '));
  const serialized=JSON.stringify(tree);
  if(serialized===lastDeployed)return;
  fs.writeFileSync(path.join(merged,'bricks-tree.json'),JSON.stringify(tree,null,2));
  lastDeployed=null;
  await run('4_inject_mcp.js',[merged,'--page',String(injection.postId),'--fix-keys','--report-dir',path.join(input.outDir,'mcp')]);
  lastDeployed=serialized;
 };
 save({status:'verifying-frontend',reviews,injection,frontendVerified:false});
 try {
 for(const section of sections){
  const checkpointPath=path.join(input.outDir,'checkpoints',section.name+'.json');
  let checkpoint;try{checkpoint=read(checkpointPath);}catch{}
  if(checkpoint?.reason==='target'&&(checkpoint.repairMode||'settings')===input.repairMode&&checkpoint.fingerprint===sectionFingerprint(read(path.join(merged,'bricks-tree.json')),section)){
   emit('reuse-accepted-section',{section:section.name});reviews.push({...checkpoint,section:section.name,reused:true});continue;
  }
  emit('review-section',{section:section.name});
  const outDir=path.join(input.outDir,'sections',section.name);
  const result=await review({...input,selective:true,frame,outDir,pageUrl:injection.permalink,section:section.name,engine:'codex',fix:true,problem:input.repairMode==='root-cause'?'Trace this section’s rendered mismatches to Figma, normalized structure and compiler mappings. Repair the isolated normalized candidate and recompile; preserve source content and responsive usability. Record shared compiler defects for regression review.':'Inspect only this section against Figma. Correct supported layout styling, preserve source content and responsive usability. Report unsupported compiler problems.'},{deploy,captureCache,budget});
  const valid=validateBuild(result.tree,merged);if(valid.errors.length)throw Error('Candidate validation failed: '+valid.errors.join('; '));
  if(result.normalizedSection||result.sourceMap||result.sectionMap){
   const ownedRoot=fs.realpathSync(input.outDir),ownedFrame=fs.realpathSync(frame);
   if(!ownedFrame.startsWith(ownedRoot+path.sep))throw Error('Root-cause corrections must stay inside this job’s isolated frame.');
   if(!/^section-[a-z0-9-]+$/i.test(section.name))throw Error('Invalid normalized section name.');
   if(result.normalizedSection)fs.writeFileSync(path.join(frame,'sections',section.name,'normalized.json'),JSON.stringify(result.normalizedSection,null,2));
   if(result.sourceMap)fs.writeFileSync(path.join(merged,'bricks-source-map.json'),JSON.stringify(result.sourceMap,null,2));
   if(result.sectionMap){
    fs.writeFileSync(path.join(merged,'section-map.json'),JSON.stringify(result.sectionMap,null,2));
    for(const current of sections){const updated=result.sectionMap.find(s=>s.name===current.name);if(updated)Object.assign(current,updated);}
   }
  }
  fs.writeFileSync(path.join(merged,'bricks-tree.json'),JSON.stringify(result.tree,null,2));
  const envelope=read(path.join(outDir,'bricks-template-import.json'));
  fs.writeFileSync(path.join(merged,'bricks-template-import.json'),JSON.stringify(envelope,null,2));
  reviews.push({section:section.name,reason:result.reason,bestScore:result.bestScore});
  fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});
  fs.writeFileSync(checkpointPath,JSON.stringify({...reviews.at(-1),repairMode:input.repairMode,fingerprint:sectionFingerprint(result.tree,section)},null,2));
  save({status:'verifying-frontend',reviews,injection,usage:budget.summary(),frontendVerified:false});
 }
 emit('validate-final-output');await run('validate-build.js',[path.join(merged,'bricks-tree.json')]);
 const finalReviews=[];
 const finalCache=new Map();
 for(const section of sections){
  emit('verify-final-section',{section:section.name});
  const result=await review({...input,frame,outDir:path.join(input.outDir,'final',section.name),pageUrl:injection.permalink,section:section.name,engine:'none',fix:false,iterations:0,problem:'Final section screenshot and DOM checks; no additional AI call.'},{deploy:async()=>{},captureCache:finalCache});
  finalReviews.push({section:section.name,reason:result.reason,bestScore:result.bestScore});
 }
 for(const name of ['bricks-template-import.json','bricks-tree.json','inject-report.json'])fs.copyFileSync(path.join(merged,name),path.join(input.outDir,name));
 const accepted=finalReviews.every(r=>r.reason==='target')&&reviews.every(r=>r.reason==='target');
 const result={status:accepted?'visual-checks-passed':'needs-review',reviews,finalReviews,injection,usage:budget.summary(),repairMode:input.repairMode,frontendCaptured:true,frontendVerified:accepted,interactionVerified:false};
 save(result);
 emit('draft-ready',{postId:injection.postId,status:result.status});return result;
 }catch(error){save({status:'verification-blocked',reviews,injection,frontendVerified:false,error:error.message});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let raw='';for await(const chunk of process.stdin)raw+=chunk;
 try{await autopilot(JSON.parse(raw));}catch(e){console.error(e.message);process.exitCode=1;}
}
