import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import {capture,compare,matchesRenderedFont} from '../studio/visual.js';
import {repairLoop,integrityFailures} from '../studio/review-worker.js';
import {saveVault} from '../studio/vault.js';
test('platform font weight suffixes are accepted without accepting fallback or unrelated families',()=>{
 assert.equal(matchesRenderedFont('Plus Jakarta Sans','Plus Jakarta Sans SemiBold'),true);
 assert.equal(matchesRenderedFont('Plus Jakarta Sans','Plus Jakarta Sans Bold Italic'),true);
 assert.equal(matchesRenderedFont('Plus Jakarta Sans','Arial'),false);
 assert.equal(matchesRenderedFont('Inter','Inter Tight'),false);
 assert.equal(matchesRenderedFont('Arial Black','Arial'),false);
});
test('browser measurements flag mobile text clipping without penalizing hidden menu content',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'responsive-evidence-'));
 const tree=[{id:'copy',name:'heading',parent:0,children:[],settings:{text:'A long editable card heading',_typography:{'font-size':'24px'},'_height:mobile_portrait':'12px','_overflow:mobile_portrait':'hidden'}},{id:'menu',name:'text',parent:0,children:[],settings:{text:'Hidden menu',_width:'800px','_display:mobile_portrait':'none'}}];
 try{
  const metrics=await capture(tree,dir,dir,[1024,390]);
  assert.equal(metrics[0].elements.find(e=>e.id==='copy').clippedText,false);
  assert.equal(metrics[1].elements.find(e=>e.id==='copy').clippedText,true);
  assert.deepEqual(integrityFailures(metrics),['390:copy:text-clipping']);
  assert.ok(fs.existsSync(path.join(dir,'390.png')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('font guard ignores wrapper inheritance but detects missing fonts on actual text',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'font-guard-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="brxe-wrap" style="font-family:MissingWrapperFont"><p id="brxe-good" style="font-family:Arial">Correct child font</p></div><p id="brxe-bad" style="font-family:MissingTextFont">Missing text font</p>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const keys=['WP_BROWSER_PASSWORD','STUDIO_BROWSER_SESSION','STUDIO_BROWSER_SESSION_KEY'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);
 try{
  const metrics=await capture([{id:'wrap',name:'div'},{id:'good',name:'text'},{id:'bad',name:'text'}],dir,dir,[390],origin,origin);
  assert.deepEqual(metrics[0].fontIssues.map(i=>i.elementId),['bad']);
 }finally{for(const k of keys)if(old[k]!==undefined)process.env[k]=old[k];await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('expired saved browser session falls back to configured login before verification',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-auth-'));let logins=0;
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.method==='POST'){logins++;res.writeHead(302,{'Set-Cookie':'wordpress_logged_in_fixture=valid; Path=/','Location':'/wp-admin/'});res.end();return;}
  if(req.url.startsWith('/wp-login.php')){res.end('<form method="post"><input id="user_login" name="log"><input id="user_pass" name="pwd" type="password"><button id="wp-submit">Login</button></form>');return;}
  if(!req.headers.cookie?.includes('=valid')){res.writeHead(302,{Location:'/wp-login.php'});res.end();return;}
  res.end('<h1>Dashboard</h1>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const keys=['STUDIO_BROWSER_SESSION','STUDIO_BROWSER_SESSION_KEY','WP_BROWSER_USERNAME','WP_BROWSER_PASSWORD'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  const file=path.join(dir,'session.vault'),key='fixture-session-key';saveVault(file,{origin,state:{cookies:[{name:'wordpress_logged_in_fixture',value:'stale',domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}},key);
  Object.assign(process.env,{STUDIO_BROWSER_SESSION:file,STUDIO_BROWSER_SESSION_KEY:key,WP_BROWSER_USERNAME:'fixture',WP_BROWSER_PASSWORD:'fixture-password'});
  const result=await capture([],dir,dir,[390],origin+'/wp-admin/',origin,{requireAuthentication:true,accessOnly:true});
  assert.equal(result[0].authenticated,true);assert.equal(logins,1);
 }finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('real browser capture checks frontend, detects missing assets and refuses inaccessible drafts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frontend-test-'));
 const server=http.createServer((req,res)=>{if(req.url==='/draft'){res.writeHead(404);res.end('Private');return;}res.setHeader('Content-Type','text/html');res.end('<div id="brxe-test">Fixture frontend</div>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const old=process.env.WP_BROWSER_PASSWORD;delete process.env.WP_BROWSER_PASSWORD;
 try{
  const result=await capture([],dir,dir,[390],origin,origin);
  assert.equal(result[0].overflow,false);assert.equal(result[0].elements[0].id,'test');assert.ok(fs.existsSync(path.join(dir,'390.png')));
  await assert.rejects(capture([],dir,dir,[390],origin+'/draft',origin),/404/);
 }finally{if(old!==undefined)process.env.WP_BROWSER_PASSWORD=old;await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('reference scaling handles 2x Figma exports without hiding browser height differences',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'compare-test-'));
 try{
  const ref=path.join(dir,'ref.png'),actual=path.join(dir,'actual.png');
  await sharp({create:{width:200,height:200,channels:3,background:'red'}}).png().toFile(ref);
  await sharp({create:{width:100,height:100,channels:3,background:'red'}}).png().toFile(actual);
  assert.equal((await compare(ref,actual,dir,100)).pixelError,0);
  await sharp({create:{width:100,height:150,channels:3,background:'red'}}).png().toFile(actual);
  assert.ok((await compare(ref,actual,dir,100)).pixelError>0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a failed candidate capture restores the best draft; low pixel error does not hide high-severity findings',async()=>{
 let restored,suggestions=0;
 await assert.rejects(repairLoop({initial:{value:1},iterations:1,target:.1,
  evaluate:async tree=>{if(tree.value===2)throw Error('browser unavailable');return {score:0};},
  suggest:async()=>{suggestions++;return {issues:[{severity:'high'}],patches:[{}]};},
  apply:()=>({value:2}),validate:()=>{},restore:async tree=>{restored=tree;}
 }),/browser unavailable/);
 assert.equal(suggestions,1);assert.deepEqual(restored,{value:1});
});
