import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {agentProvider} from './providers.js';

export function repairMode(value='settings') {
  if(!['settings','root-cause'].includes(value))throw new Error('Choose settings repair or root-cause repair.');
  return value;
}

export function framePath(root, name) {
  if(typeof name!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('Choose a design from the library.');
  const base=fs.realpathSync(path.join(root,'output')), target=fs.realpathSync(path.join(base,name));
  if(!target.startsWith(base+path.sep)||!fs.existsSync(path.join(target,'figma-node.json')))throw new Error('Design source is missing.');
  return target;
}
export function figmaUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['figma.com','www.figma.com'].includes(u.hostname)||!/^\/(design|file)\/[a-zA-Z0-9]+(?:\/|$)/.test(u.pathname)||!/^\d+[:-]\d+$/.test(u.searchParams.get('node-id')||''))throw new Error('Use a Figma design URL with node-id.');
  const node=u.searchParams.get('node-id');u.search='';u.searchParams.set('node-id',node);u.hash='';return u.href;
}
export function codexCommand(root,env) {
  // Invoke the JS entrypoint directly: no cmd.exe interpolation of user prompts.
  const candidates=[path.join(env.APPDATA||'', 'npm/node_modules/@openai/codex/bin/codex.js')];
  try{candidates.unshift(createRequire(path.join(root,'package.json')).resolve('@openai/codex/bin/codex.js'));}catch{}
  const cli=candidates.find(p=>fs.existsSync(p));
  if(!cli)throw new Error('Codex CLI was not found. Install it locally and sign in with codex login.');
  return cli;
}
export function makeTask(root,input,env) {
  const selectedRepairMode=repairMode(input.repairMode);
  const node=(script,args=[])=>({command:process.execPath,args:[path.join(root,'scripts',script),...args]});
  if(input.action==='autopilot'||input.action==='build'&&input.mode==='agent'){
    for(const key of ['FIGMA_TOKEN','WP_API_URL','WP_API_USERNAME','WP_API_PASSWORD'])if(!env[key])throw new Error(`Configure ${key} in Integrations first.`);
    const provider=agentProvider(env);
    if(!env[provider.key]&&!(provider.id==='codex'&&env.STUDIO_HOSTED!=='1'&&fs.existsSync(path.join(env.CODEX_HOME||path.join(env.USERPROFILE||env.HOME||'','.codex'),'auth.json'))))throw new Error(`Add your own ${provider.label} key in Integrations first.`);
    if(!/^[a-f0-9-]{36}$/.test(input.jobId||''))throw new Error('Missing server job ID.');
    const source=input.url?.trim()?[figmaUrl(input.url)]:['--frame',framePath(root,input.frame)],iterations=Number(input.iterations??1);
    if(!Number.isInteger(iterations)||iterations<0||iterations>2)throw new Error('One-click conversion supports 0–2 repair rounds per section.');
    return {command:process.execPath,args:[path.join(root,'studio/autopilot-worker.js')],stdin:JSON.stringify({source,outDir:path.join(root,'.studio/artifacts',input.jobId),iterations,widths:[1024,390],target:.08,repairMode:selectedRepairMode}),label:'Codex → WordPress draft',frame:null};
  }
  if(input.action==='build') {
    if(!['deterministic','api','agent'].includes(input.mode))throw new Error('Choose deterministic, API, or agent compilation.');
    const source=input.url?.trim()?[figmaUrl(input.url)]:['--frame',framePath(root,input.frame)];
    if(input.mode==='agent'){
      if(!input.jobId||!/^[a-f0-9-]{36}$/.test(input.jobId))throw new Error('Missing server job ID.');
      const iterations=Number(input.iterations??2),widths=input.widths??[1024,390],target=Number(input.target??.08);
      if(!Number.isInteger(iterations)||iterations<0||iterations>5||!Array.isArray(widths)||widths.length>4||widths.some(w=>!Number.isInteger(w)||w<320||w>3840)||!Number.isFinite(target)||target<0||target>.5)throw new Error('Invalid repair limits.');
      return {command:process.execPath,args:[path.join(root,'studio/conversion-worker.js')],stdin:JSON.stringify({source,outDir:path.join(root,'.studio','artifacts',input.jobId),section:input.section||null,problem:String(input.problem||'Inspect the selected design section').slice(0,6000),fix:!!input.fix,iterations,widths,target,repairMode:selectedRepairMode}),label:'Agent conversion and review',frame:input.url?null:input.frame};
    }
    return {...node('pipeline.js',[...source,'--no-inject','--no-visual','--no-dataset',...(input.mode==='deterministic'?['--deterministic']:[]),...(input.rebuild?['--force']:[])]),label:'Compile JSON only (no WordPress import)',frame:input.url?.trim()?null:input.frame||null};
  }
  const frame=framePath(root,input.frame);
  if(input.action==='draft')return {...node('pipeline.js',['--frame',frame,'--no-visual','--no-dataset','--title',`Studio draft - ${input.frame}`]),label:'Create WordPress draft',frame:input.frame};
  if(input.action==='test')return {command:process.execPath,args:['--test',...fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.js')).map(f=>path.join(root,'tests',f))],label:'Compiler regression tests',frame:input.frame};
  if(!['review','agent','preview'].includes(input.action))throw new Error('Unknown action.');
  if(input.action==='preview')input={...input,problem:'Capture responsive layout evidence',fix:false};
  if(typeof input.problem!=='string'||input.problem.trim().length<8||input.problem.length>6000)throw new Error('Describe the layout problem or review scope.');
  const sectionMap=JSON.parse(fs.readFileSync(path.join(frame,'merged/section-map.json'),'utf8'));
  if(!sectionMap.some(s=>s.name===input.section))throw new Error('Choose a compiled section.');
  if(input.pageUrl){const u=new URL(input.pageUrl);if(!env.WP_API_URL||u.origin!==new URL(env.WP_API_URL).origin||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Preview must be on the configured WordPress site.');}
  const iterations=Number(input.iterations??2),target=Number(input.target??.08),widths=input.widths??[1024,390];
  if(!Number.isInteger(iterations)||iterations<0||iterations>5||!Number.isFinite(target)||target<0||target>.5||!Array.isArray(widths)||widths.length>4||widths.some(w=>!Number.isInteger(w)||w<320||w>3840))throw new Error('Use 0–5 iterations, tolerance 0–0.5, and up to four viewport widths (320–3840).');
  if(!input.jobId||!/^[a-f0-9-]{36}$/.test(input.jobId))throw new Error('Missing server job ID.');
  const outDir=path.join(root,'.studio','artifacts',input.jobId);
  return {command:process.execPath,args:[path.join(root,'studio/review-worker.js')],stdin:JSON.stringify({frame,outDir,section:input.section,problem:input.problem,pageUrl:input.pageUrl||null,engine:input.action==='agent'?'codex':input.action==='review'?'api':'none',fix:!!input.fix,iterations,target,widths,repairMode:selectedRepairMode}),label:input.action==='preview'?'Capture preview':input.fix?(selectedRepairMode==='root-cause'?'Root-cause structure repair':'Bounded layout repair'):'Layout diagnosis',frame:input.frame};
}
