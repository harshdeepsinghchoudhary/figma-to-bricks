import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {jsonrepair} from 'jsonrepair';
import {z} from 'zod';
import sharp from 'sharp';
import {capture} from './visual.js';
import {sectionEvidence} from './section-evidence.js';
import {repairLoop,integrityFailures} from './review-worker.js';
import {propose} from './agent.js';
import {validatedProposal} from './validated-proposal.js';
import {applyNormalizedRepairs,NORMALIZED_REPAIR_PROMPT} from './normalized-repair.js';
import {analyzeRootCauses,compactRootCauseContext} from './root-cause-evidence.js';
import {compileRootCandidate,sectionElementIds} from './root-cause-candidate.js';
import {validateBuild} from '../scripts/validate-build.js';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const issue=z.object({severity:z.enum(['high','medium','low']),elementId:z.string().max(100).optional(),description:z.string().max(3000)}).strict();
const rule=z.object({title:z.string().min(1).max(200),evidence:z.string().min(1).max(3000),suggestedRule:z.string().min(1).max(3000),regressionCases:z.array(z.string().max(1000)).min(1).max(10)}).strict();
const responseSchema=z.object({issues:z.array(issue).max(100),patches:z.array(z.record(z.string(),z.unknown())).max(30),ruleProposals:z.array(rule).max(10).default([])}).strict();
export function parseRootCauseProposal(text){
 if(typeof text!=='string'||text.length>150000)throw Error('Invalid root-cause response size');
 const raw=text.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
 return responseSchema.parse(JSON.parse(jsonrepair(raw)));
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function compactNormalized(n){
 const keys=['id','type','figmaNodeId','text','level','layout','size','typography','background','border','responsive','component'];
 const value=Object.fromEntries(keys.filter(k=>n[k]!==undefined).map(k=>[k,n[k]]));
 if(n.asset)value.asset={nodeId:n.asset.nodeId,kind:n.asset.kind};
 if(n.children)value.children=n.children.map(compactNormalized);
 return value;
}

// The model proposes data changes only. Compilation, validation, browser tools,
// and the designated draft writer remain under the existing controller.
export async function runRootCauseReview(input,{deploy,captureCache=new Map(),budget,request=propose,capturePage=capture,compileCandidate=compileRootCandidate}={}){
 if(input.pageUrl&&!deploy)throw Error('Root-cause WordPress review requires a job-owned draft. Use one-click conversion with Root-Cause Repair Mode, or remove the frontend URL for a local isolated review.');
 const {frame,outDir}=input,treeDir=path.join(frame,'merged');
 fs.mkdirSync(outDir,{recursive:true});
 const rawRoot=read(path.join(frame,'figma-node.json')),manifest=read(path.join(frame,'asset-manifest.json'));
 const tree=read(path.join(treeDir,'bricks-tree.json')),sourceMap=read(path.join(treeDir,'bricks-source-map.json')),sectionMap=read(path.join(treeDir,'section-map.json'));
 const selected=sectionMap.find(s=>s.name===input.section);
 if(!selected||!/^section-[a-z0-9-]+$/i.test(selected.name))throw Error('Unknown root-cause repair section');
 const normalizedFile=path.join(frame,'sections',selected.name,'normalized.json');
 const normalized=read(normalizedFile),validation=validateBuild(tree,treeDir);
 if(validation.errors.length)throw Error('Initial build is invalid: '+validation.errors.join('; '));
 let sourceBox;(function walk(n){if(n.id===selected.figmaNodeId)sourceBox=n.absoluteBoundingBox;for(const c of n.children||[])walk(c);})(rawRoot);
 if(!sourceBox)throw Error('Root-cause repair requires a mapped Figma section');
 const initial={tree,normalized,sourceMap,sectionMap};
 const sourceHash=digest(rawRoot),normalizedHash=digest(normalized),width=Math.round(rawRoot.absoluteBoundingBox.width);
 const widths=[...new Set([width,...(input.widths||[1024,390])])];
 const emit=e=>console.log(JSON.stringify({event:e.stage,...e}));
 const proposals=[];let candidateNumber=0;
 const context={rawRoot,sectionSourceId:selected.figmaNodeId,manifest,assetBaseDir:frame};
 const result=await repairLoop({initial,iterations:input.fix?input.iterations:0,target:input.target,event:emit,
  onCandidateError:async error=>{fs.writeFileSync(path.join(outDir,'candidate-error.json'),JSON.stringify({error:error.message,status:'requires-development-review',originalSourcePreserved:true},null,2));},
  restore:async state=>{if(deploy)await deploy(state.tree);},
  evaluate:async(state,iteration)=>{
   const dir=path.join(outDir,String(iteration));fs.mkdirSync(dir,{recursive:true});
   if(deploy)await deploy(state.tree);
   const key=digest({tree:state.tree,widths,url:deploy?input.pageUrl:null});
   let snapshot=captureCache.get(key);
   if(!snapshot){snapshot={dir,metrics:await capturePage(state.tree,treeDir,dir,widths,deploy?input.pageUrl:null,deploy?new URL(process.env.WP_API_URL).origin:null)};captureCache.set(key,snapshot);}
   if(snapshot.dir!==dir)for(const viewport of widths)fs.copyFileSync(path.join(snapshot.dir,`${viewport}.png`),path.join(dir,`${viewport}.png`));
   const section=state.sectionMap.find(s=>s.name===selected.name),ids=sectionElementIds(state.tree,section);
   const diff=await sectionEvidence({reference:path.join(frame,'screenshot.png'),actual:path.join(snapshot.dir,`${width}.png`),dir,width,sourceBox,rootBox:rawRoot.absoluteBoundingBox,metrics:snapshot.metrics[0],ids});
   const metrics=snapshot.metrics.map(m=>({...m,elements:m.elements.filter(e=>ids.has(e.id))}));
   const causes=analyzeRootCauses({...context,normalized:state.normalized,tree:state.tree,sourceMap:state.sourceMap,metrics:snapshot.metrics,sectionRootIds:section.rootIds});
   fs.writeFileSync(path.join(dir,'root-causes.json'),JSON.stringify(causes,null,2));
   const images=[diff.referenceCrop,diff.actualCrop];
   for(const m of metrics.slice(1)){
    const elements=m.elements.filter(e=>e.width>0&&e.height>0);if(!elements.length)continue;
    const image=path.join(snapshot.dir,`${m.width}.png`),meta=await sharp(image).metadata();
    const top=Math.max(0,Math.floor(Math.min(...elements.map(e=>e.y)))),bottom=Math.min(meta.height,Math.ceil(Math.max(...elements.map(e=>e.y+e.height))));
    if(bottom>top){const crop=path.join(dir,`actual-${m.width}.png`);await sharp(image).extract({left:0,top,width:meta.width,height:bottom-top}).toFile(crop);images.push(crop);}
   }
   const failures=integrityFailures(metrics);
   return {score:diff.pixelError+(failures.length?.1:0),pixelError:diff.pixelError,integrity:!!failures.length,integrityFailures:failures,metrics,causes,images,artifact:String(iteration)};
  },
  suggest:async(state,evidence)=>{
   const failures=evidence.metrics.flatMap(m=>(m.fontIssues||[]).filter(f=>m.elements.some(e=>e.id===f.elementId)));
   if(deploy&&failures.length)return {issues:failures.map(f=>({severity:'high',elementId:f.elementId,description:`Font delivery mismatch: ${f.requested} rendered as ${f.rendered.join(', ')}`})),patches:[],stopReason:'font-unavailable'};
   if(input.engine==='none')return {issues:[],patches:[],stopReason:'diagnostic-only'};
   emit({stage:'root-cause-analysis'});
   const prompt=`You are reviewing an editable Figma-to-Bricks conversion. Image 1 is the original Figma section. Image 2 is ${deploy?'the actual WordPress draft':'a local approximation, not live WordPress verification'} at the matching desktop width. Further images are tablet/mobile captures for usability checks only; no matching responsive Figma reference is available here. Trace each mismatch through the supplied source mappings and observations. Distinguish proven causes from hypotheses. Never claim an exact cause without evidence. Prefer correcting normalized interpretation and hierarchy. Recompilation may reapply authoritative Figma values: if a patch has no effect, report a compiler mapping problem instead of forcing CSS. Preserve source content, assets, native controls, all other sections and responsive usability. Do not edit files, run shell commands, contact services, invent content, or emit CSS/URLs. Return only JSON {"issues":[{"severity":"high|medium|low","elementId":"optional Bricks ID","description":"cause and evidence"}],"patches":[],"ruleProposals":[{"title":"reusable compiler rule hypothesis","evidence":"observed failure","suggestedRule":"plain language only, no executable code","regressionCases":["positive and negative test cases"]}]}. Compiler proposals are stored for development review, never executed during conversion. ${NORMALIZED_REPAIR_PROMPT}\nScope: ${JSON.stringify(input.problem)}\nContext: ${JSON.stringify({normalized:compactNormalized(state.normalized),evidence:compactRootCauseContext(evidence.causes)})}`;
   if(prompt.length>100000)return {issues:[{severity:'high',description:'Root-cause context exceeds the review budget.'}],patches:[],stopReason:'context-budget'};
   const proposal=await validatedProposal({event:emit,correctionInstructions:`Return a complete permitted normalized proposal. ${NORMALIZED_REPAIR_PROMPT} If unsupported, report issues and empty patches.`,
    request:async feedback=>{
     if(budget&&!budget.take(prompt.length+feedback.length))return {issues:[{severity:'high',description:'Review budget reached'}],patches:[],stopReason:'review-budget'};
     return request({prompt:prompt+'\n'+feedback,images:evidence.images,engine:input.engine,workDir:outDir,parse:parseRootCauseProposal});
    },validate:p=>{if(p.stopReason==='review-budget')return;applyNormalizedRepairs(state.normalized,p.patches,context);}
   });
   proposals.push({iteration:evidence.artifact,issues:proposal.issues,patches:proposal.patches,ruleProposals:proposal.ruleProposals||[]});
   fs.writeFileSync(path.join(outDir,'proposals.json'),JSON.stringify(proposals,null,2));
   return proposal;
  },
  apply:async(state,patches)=>{
   const corrected=applyNormalizedRepairs(state.normalized,patches,context);
   emit({stage:'recompile-normalized-candidate',candidate:++candidateNumber});
   const next=await compileCandidate({frame,dir:path.join(outDir,'candidates',String(candidateNumber)),section:state.sectionMap.find(s=>s.name===selected.name),normalized:corrected,best:state,treeDir});
   return next;
  },
  validate:state=>{const v=validateBuild(state.tree,treeDir);if(v.errors.length)throw Error(v.errors.join('; '));}
 });
 if(digest(read(path.join(frame,'figma-node.json')))!==sourceHash||digest(read(normalizedFile))!==normalizedHash)throw Error('Original design data changed during isolated repair');
 const best=result.tree,envelope=read(path.join(treeDir,'bricks-template-import.json'));
 fs.writeFileSync(path.join(outDir,'bricks-template-import.json'),JSON.stringify({...envelope,content:best.tree},null,2));
 fs.writeFileSync(path.join(outDir,'normalized-candidate.json'),JSON.stringify(best.normalized,null,2));
 const cases=proposals.flatMap(p=>p.ruleProposals.map(r=>({...r,status:'requires-development-review',sourceHash,section:selected.name,evidenceArtifact:p.iteration,requiredGate:'Explicit development approval, regression fixtures across designs, and screenshot comparison before shared compiler changes.'})));
 fs.writeFileSync(path.join(outDir,'compiler-rule-proposals.json'),JSON.stringify(cases,null,2));
 const report={mode:'root-cause',status:'needs-review',renderer:deploy?'WordPress draft':'local approximation',frontendCaptured:!!deploy,frontendVerified:false,sourceHash,originalNormalizedHash:normalizedHash,bestNormalizedHash:digest(best.normalized),reason:result.reason,bestScore:result.bestScore,history:result.history,compilerRuleProposals:cases.length};
 fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2));
 emit({stage:'root-cause-review-complete',reason:result.reason,frontendVerified:false});
 return {...result,tree:best.tree,normalizedSection:best.normalized,sourceMap:best.sourceMap,sectionMap:best.sectionMap};
}
