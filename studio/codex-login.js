import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {codexCommand} from './core.js';

// Device challenges are session-only: never write them to conversion logs/history.
export function createCodexLogin(root,env,launch=spawn){
 let child=null,state={status:'not-checked',message:''};
 const home=path.join(root,'.studio','codex-auth');
 const options=()=>({cwd:root,env:{...env(),CODEX_HOME:home},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
 function start(){
  if(child)return state;
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  state={status:'waiting',message:'Requesting a device sign-in code…'};
  const p=launch(process.execPath,[codexCommand(root,env()),'-c','cli_auth_credentials_store="file"','login','--device-auth'],options());child=p;
  let output='';const timer=setTimeout(()=>{p.kill();state={status:'expired',message:'Sign-in expired. Connect again.'}},180000);timer.unref();
  const append=d=>{output=(output+d.toString().replace(/\x1b\[[0-9;]*m/g,'')).slice(-6000);state={status:'waiting',message:output};};
  p.stdout.on('data',append);p.stderr.on('data',append);
  p.on('error',()=>{clearTimeout(timer);child=null;state={status:'failed',message:'Could not start Codex CLI. Install Codex and try again.'}});
  p.on('close',code=>{clearTimeout(timer);child=null;state={status:code===0?'connected':'failed',message:code===0?'Codex account connected.':output||'Sign-in did not complete. Try again.'}});
  return state;
 }
 return {start,state:()=>({...state}),home,close:()=>child?.kill()};
}
