import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {framePath,figmaUrl,repairMode} from './core.js';
import {validateBuild} from '../scripts/validate-build.js';
import {validateReview,applyVisualPatches} from '../scripts/visual-patches.js';
import {capture,compare} from './visual.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function createMcpService(root,env=process.env){
 const base=path.join(root,'.studio-mcp');fs.mkdirSync(base,{recursive:true});let busy=false;
 const jobs=new Map();
 const redact=value=>{let s=String(value);for(const [k,v] of Object.entries(env))if(/TOKEN|PASSWORD|API_KEY|SECRET/.test(k)&&v?.length>3)s=s.split(v).join('[redacted]');return s;};
 const candidate=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid candidate ID');const dir=path.join(base,id);if(!fs.existsSync(path.join(dir,'candidate.json')))throw Error('Unknown candidate');return dir;};
 const frame=id=>{const dir=candidate(id),name=read(path.join(dir,'candidate.json')).source;return path.join(dir,'frame',name)};
 const tree=id=>read(path.join(frame(id),'merged/bricks-tree.json'));
 const saveTree=(id,t)=>{const dir=path.join(frame(id),'merged'),v=validateBuild(t,dir);if(v.errors.length)throw Error(v.errors.join('; '));const envelope=read(path.join(dir,'bricks-template-import.json'));fs.writeFileSync(path.join(dir,'bricks-tree.json'),JSON.stringify(t,null,2));fs.writeFileSync(path.join(dir,'bricks-template-import.json'),JSON.stringify({...envelope,content:t},null,2));return v;};
 function script(name,args,job,input){return new Promise((resolve,reject)=>{
  if(job.status!=='running')return reject(Error('Job cancelled'));
  const child=spawn(process.execPath,[path.join(root,'scripts',name),...args],{cwd:root,env,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:[input?'pipe':'ignore','pipe','pipe']});job.child=child;
  if(input){child.stdin.on('error',()=>{});child.stdin.end(input);}
  let output='';const append=d=>{output=(output+d.toString()).slice(-150000);job.log=redact(output)};child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',reject);child.on('close',code=>{job.child=null;code===0?resolve(output):reject(Error(`${name} failed (${code}). ${job.log.slice(-3000)}`))});
 });}
 const stop=j=>{if(j.child?.pid){if(process.platform==='win32')spawn('taskkill',['/PID',String(j.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});else process.kill(-j.child.pid,'SIGTERM');}};
 function job(work){if(busy)throw Error('A mutation is running. Poll get_job first.');busy=true;const j={id:randomUUID(),status:'running',log:''};jobs.set(j.id,j);const timer=setTimeout(()=>{j.status='timed-out';stop(j)},20*60000);timer.unref();Promise.resolve().then(()=>work(j)).then(result=>{j.result=result;if(j.status==='running')j.status='completed'}).catch(e=>{j.error=redact(e.message);if(j.status==='running')j.status='failed'}).finally(()=>{busy=false;clearTimeout(timer);fs.writeFileSync(path.join(base,'job-'+j.id+'.json'),JSON.stringify({...j,child:undefined},null,2))});return {jobId:j.id,status:j.status};}
 return {
  redact,
  convert(url,selectedRepairMode='settings'){const selected=repairMode(selectedRepairMode);return job(async j=>{const outDir=path.join(base,'conversion-'+j.id);await script('../studio/autopilot-worker.js',[],j,JSON.stringify({source:[figmaUrl(url)],outDir,iterations:2,widths:[1024,390],target:.08,repairMode:selected}));return read(path.join(outDir,'workflow.json'));});},
  list(){return fs.readdirSync(path.join(root,'output')).flatMap(name=>{try{const p=framePath(root,name);return [{name,compiled:fs.existsSync(path.join(p,'merged/bricks-tree.json'))}]}catch{return []}})},
  compile(url,savedFrame,mode="codex"){return job(async j=>{const source=url?[figmaUrl(url)]:['--frame',framePath(root,savedFrame)];const out=await script('pipeline.js',[...source,...(mode==='deterministic'?['--deterministic']:['--provider','codex']),'--no-inject','--no-visual','--no-dataset','--force'],j);return {frame:path.basename(out.match(/Frame folder: (.+)/)?.[1]?.trim()||''),frontendVerified:false}})},
  sync(){return job(async j=>{await script('sync-bricks-schema.js',[],j);return {synced:true}})},
  getJob(id){const j=jobs.get(id)||read(path.join(base,'job-'+id+'.json'));return {...j,child:undefined}},
  cancel(id){const j=jobs.get(id);if(!j||j.status!=='running')throw Error('Job is not running');j.status='cancelled';stop(j);return {cancelled:true}},
  create(name){if(busy)throw Error('Wait for the running job.');const source=framePath(root,name);if(!fs.existsSync(path.join(source,'merged/bricks-tree.json')))throw Error('Compile first');const id=randomUUID(),dir=path.join(base,id);fs.mkdirSync(dir);fs.cpSync(source,path.join(dir,'frame',name),{recursive:true,filter:p=>path.basename(p)!=='runs'});fs.writeFileSync(path.join(dir,'candidate.json'),JSON.stringify({source:name,patches:[]}));return {candidateId:id,sections:read(path.join(dir,'frame',name,'merged/section-map.json'))}},
  inspect(id,nodeId){const raw=read(path.join(frame(id),'figma-node.json'));let selected=raw; if(nodeId){selected=null;(function walk(n){if(n.id===nodeId)selected=n;for(const c of n.children||[])walk(c)})(raw);if(!selected)throw Error('Unknown Figma node');}const rawIds=new Set();(function walk(n){rawIds.add(n.id);for(const c of n.children||[])walk(c)})(selected);const map=read(path.join(frame(id),'merged/bricks-source-map.json'));return {figma:selected,elements:tree(id).filter(e=>!nodeId||rawIds.has(map[e.id]?.figmaNodeId)),sourceMap:map}},
  validate(id){return validateBuild(tree(id),path.join(frame(id),'merged'))},
  patch(id,patches){if(busy)throw Error('Wait for the running job.');const t=tree(id);validateReview({issues:[],patches},new Set(t.map(e=>e.id)));if(patches.some(p=>p.op!=='settings'))throw Error('Only bounded settings patches are supported');const p=path.join(candidate(id),'candidate.json'),meta=read(p);if(meta.patches.length+patches.length>300)throw Error('Candidate repair budget exceeded');const result=saveTree(id,applyVisualPatches(t,patches));meta.patches.push(...patches);fs.writeFileSync(p,JSON.stringify(meta));return result},
  async capture(id,width,url){if(busy)throw Error('Wait for the running job.');busy=true;try{const dir=path.join(candidate(id),url?'frontend':'preview'),t=tree(id);const metrics=await capture(t,path.join(frame(id),'merged'),dir,[width],url||null,env.WP_API_URL?new URL(env.WP_API_URL).origin:null);const sourceWidth=Math.round(read(path.join(frame(id),'figma-node.json')).absoluteBoundingBox.width);const diff=sourceWidth===width?await compare(path.join(frame(id),'screenshot.png'),path.join(dir,width+'.png'),dir):{note:'No matching responsive Figma reference; DOM integrity checks only.'};return {metrics,diff,renderer:url?'WordPress frontend':'local approximation',frontendVerified:false}}finally{busy=false}},
  imagePath(id,kind,width){return kind==='figma'?path.join(frame(id),'screenshot.png'):path.join(candidate(id),kind==='frontend'?'frontend':'preview',kind==='overlay'||kind==='heatmap'?kind+'.png':width+'.png')},
  export(id){const v=this.validate(id);if(v.errors.length)throw Error(v.errors.join('; '));return {path:path.join(frame(id),'merged/bricks-template-import.json'),editable:true}},
  draft(id){const dir=candidate(id);if(fs.existsSync(path.join(dir,'draft.json')))return {existingDraft:read(path.join(dir,'draft.json'))};return job(async j=>{const f=frame(id),merged=path.join(f,'merged');await script('setup-pipeline-menus.js',[f],j);await script('merge_sections.js',[f,...read(path.join(merged,'section-map.json')).map(s=>s.name)],j);const patches=read(path.join(dir,'candidate.json')).patches;saveTree(id,applyVisualPatches(tree(id),patches));await script('4_inject_mcp.js',[merged,'--title','Studio MCP draft','--fix-keys','--report-dir',path.join(dir,'mcp')],j);const result=read(path.join(merged,'inject-report.json'));fs.writeFileSync(path.join(dir,'draft.json'),JSON.stringify(result));return result})},
  close(){for(const j of jobs.values())if(j.status==='running')stop(j)},
 };
}
