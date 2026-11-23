import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import dotenv from 'dotenv';
import {makeTask,framePath,codexCommand} from './core.js';
import {validateBuild} from '../scripts/validate-build.js';
import {saveVault,unlockVault} from './vault.js';
import {createBrowserLogin} from './browser-login.js';
import {createCodexLogin} from './codex-login.js';
import {cleanupAgentSessions} from './session-cleanup.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowedKeys=['FIGMA_TOKEN','WP_API_URL','WP_API_USERNAME','WP_API_PASSWORD','WP_BROWSER_USERNAME','WP_BROWSER_PASSWORD','AI_PROVIDER','ANTHROPIC_API_KEY','GEMINI_API_KEY','GROQ_API_KEY','NVIDIA_API_KEY','ANTHROPIC_MODEL','GEMINI_MODEL','GROQ_MODEL','NVIDIA_MODEL','VISUAL_PROVIDER','VISUAL_MODEL','VISUAL_MAX_TOKENS','STUDIO_AGENT_MODEL','STUDIO_AGENT_PROVIDER','CODEX_API_KEY','OLLAMA_HOST','OLLAMA_MODEL','OLLAMA_VISION_MODEL'];
const readJson=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
export function createStudio({workspace=root,spawnImpl=spawn}={}) {
 const token=randomBytes(32).toString('hex'), sessionEnv={}, jobs=new Map();let active=null;
 const dataDir=path.join(workspace,'.studio');fs.mkdirSync(dataDir,{recursive:true});
 const projectFile=path.join(dataDir,'projects.json'),projects=readJson(projectFile,[]);
 const vaultFile=path.join(dataDir,'connections.vault');
 for(const file of fs.readdirSync(dataDir).filter(f=>f.endsWith('.json'))){const j=readJson(path.join(dataDir,file));if(j?.id&&/^[a-f0-9-]{36}$/.test(j.id)){if(['running','cancelling'].includes(j.status))j.status='interrupted';cleanupAgentSessions(path.join(dataDir,'artifacts',j.id));jobs.set(j.id,j);}}
 const env=()=>({...process.env,...dotenv.parse(fs.existsSync(path.join(workspace,'.env'))?fs.readFileSync(path.join(workspace,'.env')):''),...sessionEnv,...(fs.existsSync(path.join(dataDir,'codex-auth','auth.json'))?{CODEX_HOME:path.join(dataDir,'codex-auth')}:{})});
 const codexLogin=createCodexLogin(workspace,env);
 const browserKey=randomBytes(32).toString('hex'),browserFile=path.join(dataDir,'browser-session.vault');
 const browserLogin=createBrowserLogin(browserFile,browserKey,env);
 const redact=value=>{let s=String(value);for(const [key,v] of Object.entries(env()))if(/TOKEN|PASSWORD|API_KEY|SECRET/.test(key)&&v?.length>3)s=s.split(v).join('[redacted]');return s;};
 const save=j=>fs.writeFileSync(path.join(dataDir,j.id+'.json'),JSON.stringify(j,null,2));
 function designs(){const output=path.join(workspace,'output');return fs.existsSync(output)?fs.readdirSync(output).flatMap(name=>{try{const dir=framePath(workspace,name);const report=readJson(path.join(dir,'merged/inject-report.json'));return [{name,sections:readJson(path.join(dir,'merged/section-map.json'),[]).map(s=>({name:s.name,figmaNodeId:s.figmaNodeId})),hasScreenshot:fs.existsSync(path.join(dir,'screenshot.png')),hasBuild:fs.existsSync(path.join(dir,'merged/bricks-tree.json')),postId:report?.postId||null}];}catch{return []}}):[];}
 function state(){const e=env();let codex=false;try{codexCommand(workspace,e);codex=true}catch{}return {hosted:process.env.STUDIO_HOSTED==='1',codexLogin:codexLogin.state(),projects,designs:designs(),jobs:[...jobs.values()].reverse().slice(0,50).map(j=>({...j,usage:readJson(path.join(dataDir,'artifacts',j.id,'usage.json')),report:readJson(path.join(dataDir,'artifacts',j.id,'report.json')),workflow:readJson(path.join(dataDir,'artifacts',j.id,'workflow.json'))})),active:active?.id||null,connections:{figma:!!e.FIGMA_TOKEN,bricks:!!(e.WP_API_URL&&e.WP_API_USERNAME&&e.WP_API_PASSWORD),codex,api:['ANTHROPIC','GEMINI','GROQ','NVIDIA'].some(p=>!!e[p+'_API_KEY']),browserPassword:!!e.WP_BROWSER_PASSWORD,browserSession:!!e.STUDIO_BROWSER_SESSION,provider:e.AI_PROVIDER||'auto'},configKeys:allowedKeys};}
 function start(input,resumeFrom=null){input=Object.fromEntries(['action','frame','url','mode','section','problem','pageUrl','fix','iterations','target','widths','rebuild','repairMode'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));if(active)throw new Error('A task is running. Wait for it to finish before starting another.');const id=randomUUID();const spec=resumeFrom?{command:process.execPath,args:[path.join(workspace,'studio/resume-verification.js')],stdin:JSON.stringify({priorId:resumeFrom,outDir:path.join(dataDir,'artifacts',id),repairMode:input.repairMode}),label:'Resume draft browser verification',frame:null}:makeTask(workspace,{...input,jobId:id},env());const job={id,label:spec.label,frame:spec.frame,status:'running',input,startedAt:new Date().toISOString(),log:'',events:[],visualStatus:'Not verified'};jobs.set(job.id,job);save(job);
  const child=spawnImpl(spec.command,spec.args,{cwd:workspace,env:env(),windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});active={id:job.id,child};
  const timeout=setTimeout(()=>cancel(job.id,'timed-out'),(input.action==='autopilot'?60:20)*60*1000);timeout.unref();
  let settled=false;const finish=(code,message)=>{if(settled)return;settled=true;clearTimeout(timeout);job.status=job.status==='cancelling'?'cancelled':job.status==='timed-out'?'timed-out':code===0?'completed':'failed';job.exitCode=code;job.finishedAt=new Date().toISOString();if(message)job.log+='\n'+redact(message);
   try{if(!code){const artifacts=path.join(dataDir,'artifacts',job.id);fs.mkdirSync(artifacts,{recursive:true});let f=job.frame;if(!f){const m=job.log.match(/Frame folder: (.+)/);if(m)f=path.basename(m[1].trim());}if(f){job.frame=f;const dir=framePath(workspace,f);for(const name of ['bricks-template-import.json','bricks-tree.json','inject-report.json']){const src=path.join(dir,'merged',name),dest=path.join(artifacts,name);if(fs.existsSync(src)&&!fs.existsSync(dest))fs.copyFileSync(src,dest);}}}}catch(e){job.status='failed';job.log+='\nArtifact snapshot failed: '+redact(e.message);}
   try{cleanupAgentSessions(path.join(dataDir,'artifacts',job.id));}catch{job.log+='\nTemporary authentication cleanup failed; restart Studio to retry cleanup.';}active=null;save(job);};
  let pending='';const append=d=>{pending+=d.toString();const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){const safe=redact(line);job.log=(job.log+safe+'\n').slice(-160000);try{const e=JSON.parse(safe);if(e.event)job.events.push({...e,time:new Date().toISOString()});}catch{}job.events=job.events.slice(-100);}save(job);};child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',e=>finish(1,e.message));child.on('close',code=>{if(pending)job.log+='\n'+redact(pending);finish(code??1);});child.stdin.end(spec.stdin||'');return job;
 }
 function cancel(id,status='cancelling'){if(active?.id!==id)throw new Error('This job is not running.');const job=jobs.get(id);job.status=status;save(job);const pid=active.child.pid;if(process.platform==='win32'&&pid)spawn('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});else if(pid)process.kill(-pid,'SIGTERM');else active.child.kill('SIGTERM');return {cancelled:true};}
 const server=http.createServer(async(req,res)=>{
  const send=(code,value,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(value):value);};
  try{
   const authority=`127.0.0.1:${server.address().port}`;
   if(req.headers.host!==authority)return send(403,{error:'Open Studio using its 127.0.0.1 address.'});
   const url=new URL(req.url,`http://${authority}`);
   if(url.pathname==='/'&&url.searchParams.get('token')===token){res.writeHead(303,{'Set-Cookie':`studio=${token}; HttpOnly; SameSite=Strict; Path=/`,'Location':'/','Referrer-Policy':'no-referrer'});return res.end();}
   if(!(req.headers.cookie||'').split(';').some(s=>s.trim()===`studio=${token}`))return send(401,{error:'Open the startup URL printed in your terminal.'});
   if(req.method==='POST'){
    if(req.headers.origin!==`http://${authority}`||!req.headers['content-type']?.startsWith('application/json'))return send(403,{error:'Same-origin JSON requests required.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)return send(413,{error:'Request too large'});}const input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected a JSON object.');
    if(url.pathname==='/api/config'){for(const [key,value] of Object.entries(input)){if(!allowedKeys.includes(key)||typeof value!=='string'||value.length>4096||/[\r\n\0]/.test(value))throw new Error('Invalid connection setting.');}Object.assign(sessionEnv,input);return send(200,{saved:true});}
    if(url.pathname==='/api/codex/connect'){if(process.env.STUDIO_HOSTED==='1')throw Error('Hosted accounts use their own API key. Local device login is not available here.');return send(200,codexLogin.start());}
    if(url.pathname==='/api/browser/open'){if(active)throw Error('Wait for the current run to finish.');return send(200,await browserLogin.open());}
    if(url.pathname==='/api/browser/finish'){const result=await browserLogin.finish();sessionEnv.STUDIO_BROWSER_SESSION=browserFile;sessionEnv.STUDIO_BROWSER_SESSION_KEY=browserKey;return send(200,result);}
    if(url.pathname==='/api/jobs')return send(202,start(input));
    if(url.pathname==='/api/vault/save'){saveVault(vaultFile,{...Object.fromEntries(allowedKeys.filter(k=>env()[k]).map(k=>[k,env()[k]])),...(sessionEnv.STUDIO_BROWSER_SESSION?{_browserSession:unlockVault(browserFile,browserKey)}:{})},input.password);return send(200,{saved:true});}
    if(url.pathname==='/api/vault/unlock'){const values=unlockVault(vaultFile,input.password);for(const [k,v] of Object.entries(values))if(allowedKeys.includes(k)&&typeof v==='string')sessionEnv[k]=v;if(values._browserSession&&env().WP_API_URL&&values._browserSession.origin===new URL(env().WP_API_URL).origin){saveVault(browserFile,values._browserSession,browserKey);sessionEnv.STUDIO_BROWSER_SESSION=browserFile;sessionEnv.STUDIO_BROWSER_SESSION_KEY=browserKey;}return send(200,{unlocked:true});}
    if(url.pathname==='/api/figma-frames'){
     if(!env().FIGMA_TOKEN)throw new Error('Configure FIGMA_TOKEN first.');const u=new URL(input.url),match=u.pathname.match(/^\/(?:design|file)\/([a-zA-Z0-9]+)(?:\/|$)/);
     if(u.protocol!=='https:'||!['figma.com','www.figma.com'].includes(u.hostname)||!match)throw new Error('Enter a valid Figma file URL.');
     const response=await fetch(`https://api.figma.com/v1/files/${match[1]}?depth=2`,{headers:{'X-Figma-Token':env().FIGMA_TOKEN},signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw new Error(`Figma returned ${response.status}. Check token access and file sharing.`);const data=await response.json();
     return send(200,{frames:(data.document?.children||[]).flatMap(page=>(page.children||[]).filter(n=>['FRAME','COMPONENT'].includes(n.type)).map(n=>({id:n.id,name:n.name,page:page.name,url:`https://www.figma.com/design/${match[1]}?node-id=${n.id.replace(':','-')}`})))});
    }
    if(url.pathname==='/api/cancel')return send(200,cancel(input.id));
    if(url.pathname==='/api/retry'){const job=jobs.get(input.id);if(!job?.input)throw new Error('This historical run cannot be retried.');const workflow=readJson(path.join(dataDir,'artifacts',job.id,'workflow.json'));return send(202,start(job.input,workflow?.injection?.postId?job.id:null));}
    if(url.pathname==='/api/projects'){
     if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw new Error('Project name must be 1–100 characters.');
     if(input.frame)framePath(workspace,input.frame);
     const p={id:randomUUID(),name:input.name.trim(),frame:input.frame||null,createdAt:new Date().toISOString()};projects.push(p);fs.writeFileSync(projectFile,JSON.stringify(projects,null,2));return send(201,p);
    }
    return send(404,{error:'Not found'});
   }
   if(req.method!=='GET')return send(405,{error:'Method not allowed'});
   if(url.pathname==='/api/state')return send(200,state());
   if(url.pathname==='/api/reference'){const dir=framePath(workspace,url.searchParams.get('frame'));return send(200,fs.readFileSync(path.join(dir,'screenshot.png')),'image/png');}
   if(url.pathname==='/api/export'||url.pathname==='/api/validation'){
    const dir=path.join(framePath(workspace,url.searchParams.get('frame')),'merged');const tree=readJson(path.join(dir,'bricks-tree.json'));if(!tree)throw new Error('Compile this design first.');const result=validateBuild(tree,dir);
    if(url.pathname==='/api/validation')return send(200,result);if(result.errors.length)throw new Error('Export blocked: generated tree failed validation.');res.setHeader('Content-Disposition','attachment; filename="bricks-template-import.json"');return send(200,readJson(path.join(dir,'bricks-template-import.json')));
   }
   if(url.pathname==='/api/artifact'){
    const job=jobs.get(url.searchParams.get('job')),file=url.searchParams.get('file');if(!job||!file||!/^(?:(?:sections|final)\/[a-zA-Z0-9_-]+\/)?([0-5](?:-candidate)?\/|frontend\/)?(?:[0-9]{3,4}\.png|actual-[0-9]{3,4}\.png|reference-section\.png|actual-section\.png|usage\.json|conversion-audit\.json|heatmap\.png|overlay\.png|access-error\.png|access-error\.json|metrics\.json|report\.json|bricks-template-import\.json|root-causes\.json|normalized-candidate\.json|compiler-rule-proposals\.json|proposals\.json|candidate-error\.json)$/.test(file))throw new Error('Unknown artifact.');
    const location=path.join(dataDir,'artifacts',job.id,file);if(!fs.existsSync(location))return send(404,{error:'Artifact is not available.'});if(file.endsWith('bricks-template-import.json'))res.setHeader('Content-Disposition','attachment; filename="bricks-template-import.json"');return send(200,file.endsWith('.png')?fs.readFileSync(location):readJson(location),file.endsWith('.png')?'image/png':'application/json');
   }
   const dist=path.join(workspace,'studio/dist'),built=fs.existsSync(path.join(dist,'index.html'));
   if(built&&(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname))){const location=path.join(dist,url.pathname==='/'?'index.html':url.pathname.slice(1));return send(200,fs.readFileSync(location),location.endsWith('.js')?'text/javascript':location.endsWith('.css')?'text/css':'text/html');}
   if(url.pathname==='/')return send(503,'Build the Studio interface first: npm.cmd run studio:build','text/plain');
   send(404,{error:'Not found'});
  }catch(e){send(400,{error:redact(e.message)});}
 });
 server.on('close',()=>{codexLogin.close();browserLogin.close().catch(()=>{});});
 return {server,token,state};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server,token}=createStudio();server.listen(process.env.STUDIO_PORT===undefined?4317:Number(process.env.STUDIO_PORT),'127.0.0.1',()=>console.log(`Figma → Bricks Studio\nOpen http://127.0.0.1:${server.address().port}/?token=${token}\nLocal workspace: ${root}\nKeep this terminal open. Press Ctrl+C to stop.`));
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Studio port is already in use. Set STUDIO_PORT to another port.':e.message);process.exitCode=1;});
}
