import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexLogin} from '../studio/codex-login.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cleanupAgentSessions} from '../studio/session-cleanup.js';
test('cancel cleanup removes nested temporary auth while preserving persistent sign-in',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cleanup-'));
 try{
  const temporary=path.join(root,'sections','section-02','.agent-session'),persistent=path.join(root,'codex-auth');
  fs.mkdirSync(temporary,{recursive:true});fs.mkdirSync(persistent);fs.writeFileSync(path.join(temporary,'auth.json'),'fixture');fs.writeFileSync(path.join(persistent,'auth.json'),'fixture');
  cleanupAgentSessions(root);assert.ok(!fs.existsSync(temporary));assert.ok(fs.existsSync(path.join(persistent,'auth.json')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Codex connection uses device auth without a shell and clears its challenge after success',()=>{
 let child,calls=0;
 const login=createCodexLogin(process.cwd(),()=>process.env,(command,args,options)=>{
  calls++;assert.equal(command,process.execPath);assert.ok(args.includes('--device-auth'));assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.ok(options.env.CODEX_HOME.endsWith('codex-auth'));
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;
 });
 login.start();login.start();assert.equal(calls,1);
 child.stdout.write('Open https://auth.openai.com/codex/device and enter FIXTURE-CODE');
 assert.match(login.state().message,/FIXTURE-CODE/);child.emit('close',0);
 assert.equal(login.state().status,'connected');assert.ok(!login.state().message.includes('FIXTURE-CODE'));
});
