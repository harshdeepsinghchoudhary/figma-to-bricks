import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Codex} from '@openai/codex-sdk';
import {callVision,visionConfig} from '../scripts/vision-client.js';
import {parseVisualResponse} from '../scripts/visual-response.js';
import {recordUsage} from './usage.js';
import {agentProvider} from './providers.js';

// No compiler execution, filesystem edits, user MCP servers or WordPress
// credentials are exposed to the reasoning runtime. The controller owns tools.
export async function propose({prompt,images,ids,engine,workDir,timeoutMs=180000,parse=text=>parseVisualResponse(text,ids).review}){
 if(engine==='codex'&&agentProvider(process.env).id!=='codex'){
  const provider=agentProvider(process.env);
  const config=visionConfig({...process.env,VISUAL_PROVIDER:provider.id,VISUAL_MODEL:process.env.STUDIO_AGENT_MODEL||process.env[provider.id.toUpperCase()+'_MODEL']||''});
  const response=await callVision(prompt,images.map(p=>fs.readFileSync(p).toString('base64')),config);
  return parse(response.text);
 }
 if(engine==='api'){
  const response=await callVision(prompt,images.map(p=>fs.readFileSync(p).toString('base64')),visionConfig());
  return parse(response.text);
 }
 const home=path.join(workDir,'.agent-session');fs.mkdirSync(home,{recursive:true,mode:0o700});
 try{
  const auth=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'auth.json');
  if(process.env.STUDIO_HOSTED!=='1'&&fs.existsSync(auth)){fs.copyFileSync(auth,path.join(home,'auth.json'));fs.chmodSync(path.join(home,'auth.json'),0o600);}
  const safeEnv=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOME','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  safeEnv.CODEX_HOME=home;
  const sdk=new Codex({env:safeEnv,...(process.env.CODEX_API_KEY?{apiKey:process.env.CODEX_API_KEY}:{}),config:{features:{shell_tool:false,apply_patch_freeform:false,apps:false,multi_agent:false},web_search:'disabled'}});
  const thread=sdk.startThread({workingDirectory:home,skipGitRepoCheck:true,sandboxMode:'read-only',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled',...(process.env.STUDIO_AGENT_MODEL?{model:process.env.STUDIO_AGENT_MODEL}:{})});
  const result=await thread.run([{type:'text',text:prompt},...images.map(p=>({type:'local_image',path:p}))],{signal:AbortSignal.timeout(timeoutMs)});
  recordUsage(process.env.STUDIO_USAGE_FILE,{phase:'browser-review-result',tokenUsage:result.usage||null});
  return parse(result.finalResponse);
 }finally{fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
