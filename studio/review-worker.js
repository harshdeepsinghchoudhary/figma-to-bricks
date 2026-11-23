import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sectionEvidence,compactReviewContext} from './section-evidence.js';
import {fileURLToPath} from 'node:url';
import {capture,compare} from './visual.js';
import {propose} from './agent.js';
import {validatedProposal} from './validated-proposal.js';
import {filterVisualPatches,applyVisualPatches,visualPatchSettings} from '../scripts/visual-patches.js';
import {validateBuild} from '../scripts/validate-build.js';
import {runRootCauseReview} from './root-cause-review.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
// Keep integrity separate from pixel similarity: a better desktop image must
// never buy acceptance of a new tablet/mobile overflow or missing image.
export function integrityFailures(metrics){
 const failures=[];
 for(const m of metrics||[]){
  if(m.overflow)failures.push(`${m.width}:page-overflow`);
  for(const e of m.elements||[]){
   if(e.display==='none'||e.width<=0||e.height<=0)continue;
   if(e.x< -1||e.x+e.width>m.width+1)failures.push(`${m.width}:${e.id}:overflow`);
   if(e.brokenImage)failures.push(`${m.width}:${e.id}:image`);
   if(e.clippedText)failures.push(`${m.width}:${e.id}:text-clipping`);
  }
 }
 return [...new Set(failures)];
}
export async function repairLoop({initial,iterations,target,evaluate,suggest,validate,apply,event=()=>{},restore=async()=>{},onCandidateError}){
 let best=structuredClone(initial),bestScore=Infinity;const history=[];let reason='iteration-limit';
 try {
 for(let i=0;i<=iterations;i++){
  event({stage:'capture-and-compare',iteration:i});const evidence=await evaluate(best,i);
  const score=evidence.score;
  if(i===0||score<bestScore){bestScore=score;}
  history.push({iteration:i,...evidence});
  const proposal=await suggest(best,evidence,i);
  history.at(-1).issues=proposal.issues;history.at(-1).patches=proposal.patches;
  if(score<=target&&!proposal.issues?.some(issue=>issue.severity==='high'||issue.severity==='medium')){reason='target';break;}
  if(proposal.stopReason){reason=proposal.stopReason;break;}
  if(i===iterations)break;
  if(!proposal.patches.length){reason='no-proposed-improvement';break;}
  let candidate;
  try{candidate=await apply(best,proposal.patches);await validate(candidate);}catch(error){
   if(!onCandidateError)throw error;
   history.at(-1).candidateError=error.message;reason='candidate-rejected';
   event({stage:'candidate-rejected',iteration:i,reason:error.message});await onCandidateError(error,proposal);break;
  }
  event({stage:'validate-candidate',iteration:i});const next=await evaluate(candidate,`${i}-candidate`);
  history.at(-1).candidate=next;
  const previousFailures=new Set(evidence.integrityFailures||[]);
  if((next.integrityFailures||[]).some(f=>!previousFailures.has(f))){reason='responsive-regression';break;}
  if(next.score>=bestScore-.0001){reason='no-measurable-improvement';break;}
  best=candidate;bestScore=next.score;
 }
 } finally { await restore(best); }
 return {tree:best,history,bestScore,reason};
}
export async function runReview(input,{deploy,captureCache=new Map(),budget}={}){
 if(input.repairMode==='root-cause')return runRootCauseReview(input,{deploy,captureCache,budget});
 const {frame,outDir}=input,treeDir=path.join(frame,'merged');fs.mkdirSync(outDir,{recursive:true});
 const tree=read(path.join(treeDir,'bricks-tree.json')),raw=read(path.join(frame,'figma-node.json'));
 const initialValidation=validateBuild(tree,treeDir);if(initialValidation.errors.length)throw new Error('Source build failed validation: '+initialValidation.errors.join('; '));
 const width=Math.round(raw.absoluteBoundingBox.width),widths=[...new Set([width,...(input.widths||[1024,390])])];
 const map=read(path.join(treeDir,'section-map.json')),sourceMap=read(path.join(treeDir,'bricks-source-map.json'));
 const selected=map.find(s=>s.name===input.section);if(!selected)throw new Error('Unknown section.');
  const ids=new Set(tree.filter(e=>{let p=e;const by=new Map(tree.map(n=>[n.id,n]));while(p){if(selected.rootIds?.includes(p.id))return true;p=by.get(p.parent);}return false}).map(e=>e.id));
 // Scope by source section root when section-map field names differ.
 const sectionSource=selected.figmaNodeId;const rawIds=new Set();(function walk(n,inside=false){inside ||= n.id===sectionSource;if(inside)rawIds.add(n.id);for(const c of n.children||[])walk(c,inside)})(raw);
 for(const e of tree)if(rawIds.has(sourceMap[e.id]?.figmaNodeId))ids.add(e.id);
 if(!ids.size)throw new Error('No source-mapped elements in section. Recompile before review.');
 let sourceBox;(function find(n){if(n.id===sectionSource)sourceBox=n.absoluteBoundingBox;for(const c of n.children||[])find(c)})(raw);
 const reference=path.join(frame,'screenshot.png'),report={status:'running',renderer:'local approximation',frontendVerified:false,section:input.section};
 const emit=e=>console.log(JSON.stringify({event:e.stage,...e}));
 if(input.pageUrl&&!deploy){emit({stage:'capture-frontend'});report.frontendMetrics=await capture(tree,treeDir,path.join(outDir,'frontend'),widths,input.pageUrl,new URL(process.env.WP_API_URL).origin);report.frontendComparison=await compare(reference,path.join(outDir,'frontend',`${width}.png`),path.join(outDir,'frontend'),width);report.frontendCaptured=true;}
 const result=await repairLoop({initial:tree,iterations:input.fix?input.iterations:0,target:input.target,
  restore:deploy||undefined,
  event:emit,
  evaluate:async(candidate,iteration)=>{
   const dir=path.join(outDir,String(iteration));fs.mkdirSync(dir,{recursive:true});if(deploy)await deploy(candidate);
   const key=createHash('sha256').update(JSON.stringify({candidate,widths,url:deploy?input.pageUrl:null})).digest('hex');
   let snapshot=captureCache.get(key);
   if(!snapshot){const metrics=await capture(candidate,treeDir,dir,widths,deploy?input.pageUrl:null,deploy?new URL(process.env.WP_API_URL).origin:null);snapshot={metrics,dir};captureCache.set(key,snapshot);}
   const metrics=snapshot.metrics;const actual=path.join(snapshot.dir,`${width}.png`);
   if(snapshot.dir!==dir)fs.copyFileSync(actual,path.join(dir,`${width}.png`));
   const diff=await sectionEvidence({reference,actual,dir,width,sourceBox,rootBox:raw.absoluteBoundingBox,metrics:metrics[0],ids});
   const scoped=metrics.map(m=>({...m,elements:m.elements.filter(e=>ids.has(e.id))}));
   const failures=integrityFailures(scoped),integrity=failures.length>0;
   return {score:diff.pixelError+(integrity?.1:0),metrics:scoped,pixelError:diff.pixelError,integrity,integrityFailures:failures,artifact:String(iteration)};
  },
  suggest:async(candidate,evidence)=>{
   const fontIssues=evidence.metrics.flatMap(m=>(m.fontIssues||[]).filter(f=>ids.has(f.elementId)));
   if(deploy&&fontIssues.length)return {issues:fontIssues.map(f=>({severity:'high',elementId:f.elementId,description:`Font unavailable: requested ${f.requested}, browser rendered ${f.rendered.join(', ')}. Repair font delivery before changing layout.`})),patches:[],stopReason:'font-unavailable'};
   if(input.engine==='none')return {issues:[],patches:[],stopReason:'diagnostic-only'};
   if(input.selective&&evidence.score<=input.target&&!evidence.integrity)return {issues:[],patches:[]};
   const context=candidate.filter(e=>ids.has(e.id));
   const source=[];(function w(n){if(rawIds.has(n.id))source.push({id:n.id,box:n.absoluteBoundingBox,style:n.style,itemSpacing:n.itemSpacing,fills:n.fills?.map(({imageRef,...paint})=>paint)});for(const c of n.children||[])w(c)})(raw);
   const prompt=`Compare Figma image 1 and ${deploy?'actual WordPress frontend':'local Bricks approximation'} image 2. Source measurements are authoritative. Report missing content and broken native controls. Do not infer functional correctness from screenshots. User scope: ${JSON.stringify(input.problem)}. Never change source code, content, assets, URLs or other sections. Return ONLY JSON {"issues":[{"severity":"high|medium|low","elementId":"id","description":"evidence"}],"patches":[{"op":"settings","id":"id","set":{"_padding":{"top":"24"}}}]}. Max 30 patches. Allowed base setting names: ${visualPatchSettings().join(', ')}. Responsive suffixes: :tablet_portrait, :mobile_landscape, :mobile_portrait. Never emit _cssCustom, CSS selectors, scripts, or asset URLs. Use native settings for alignment, sizing and spacing. Buttons use _flexDirection/_gap/iconGap; text, heading, image and icon leaves must not receive flex-container direction or gap settings. If this requires a compiler fix report it and return no patches. Preserve responsive usability. Context: ${JSON.stringify(compactReviewContext(context,source,evidence.metrics))}`;
   if(prompt.length>100000)return {issues:[{severity:'high',description:'Section requires more context than the review budget allows. No correction was applied.'}],patches:[],stopReason:'context-budget'};
   const frontendContext=report.frontendCaptured?' Image 3 is the initial real WordPress frontend. Use it to diagnose renderer differences, but it has NOT received candidate patches. Do not claim candidate fixes are verified there.':'';
   const proposal=await validatedProposal({event:emit,request:async feedback=>{if(budget&&!budget.take(prompt.length+feedback.length))return {issues:[{severity:'high',description:'AI review budget reached; section remains unresolved.'}],patches:[],stopReason:'review-budget'};emit({stage:'agent-analysis'});return propose({prompt:prompt+frontendContext+'\n'+feedback,images:[path.join(outDir,evidence.artifact,'reference-section.png'),path.join(outDir,evidence.artifact,'actual-section.png'),...(report.frontendCaptured?[path.join(outDir,'frontend',`${width}.png`)]:[])],ids,engine:input.engine,workDir:outDir});},validate:proposal=>{
    if(proposal.patches.some(p=>!ids.has(p.id)||p.op!=='settings'))throw new Error('Agent proposed an out-of-scope operation.');
    const checked=applyVisualPatches(candidate,proposal.patches);const valid=validateBuild(checked,treeDir);if(valid.errors.length)throw new Error(valid.errors.join('; '));
   }});
   if(proposal.patches.some(p=>!ids.has(p.id)||p.op!=='settings'))throw new Error('Agent proposed an out-of-scope operation.');
   return {...proposal,patches:filterVisualPatches(candidate,proposal.patches).patches};
  },
  apply:(candidate,patches)=>applyVisualPatches(candidate,patches),
  validate:candidate=>{const v=validateBuild(candidate,treeDir);if(v.errors.length)throw new Error(v.errors.join('; '));}
 });
 // Isolated artifact: original merged output and compiler source are untouched.
 const original=read(path.join(treeDir,'bricks-template-import.json'));
 fs.writeFileSync(path.join(outDir,'bricks-template-import.json'),JSON.stringify({...original,content:result.tree},null,2));
 fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify({...report,status:'needs-review',...result,frontendCaptured:!!deploy||report.frontendCaptured,tree:undefined},null,2));emit({stage:'review-complete',reason:result.reason,frontendVerified:false});return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){let text='';for await(const chunk of process.stdin)text+=chunk;try{await runReview(JSON.parse(text));}catch(e){console.error(e.message);process.exitCode=1;}}
