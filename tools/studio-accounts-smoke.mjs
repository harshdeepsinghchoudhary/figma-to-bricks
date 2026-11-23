import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHostedPreview} from '../studio/hosted-preview.js';
import {chromium} from 'playwright-core';
const dir=fs.mkdtempSync(path.resolve('.test-work/accounts-')),app=createHostedPreview({dataDir:dir,invite:'fixture-invite-code'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
async function request(route,body,cookie){const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {response,data:await response.json()}}
try{
 const a=await request('/api/account/register',{email:'a@example.test',password:'fixture-password-a',invite:'fixture-invite-code'}),b=await request('/api/account/register',{email:'b@example.test',password:'fixture-password-b',invite:'fixture-invite-code'});
 const ca=a.response.headers.get('set-cookie').split(';')[0],cb=b.response.headers.get('set-cookie').split(';')[0];
 assert.equal(a.response.status,200);assert.equal(b.response.status,200);
 assert.equal((await request('/api/state')).response.status,401);
 assert.equal((await request('/api/config',{FIGMA_TOKEN:'user-a-fixture'},ca)).response.status,200);
 const sa=await request('/api/state',undefined,ca),sb=await request('/api/state',undefined,cb);
 assert.equal(sa.data.connections.figma,true);assert.equal(sb.data.connections.figma,false);assert.deepEqual(sb.data.designs,[]);
 assert.ok(!JSON.stringify(sa.data).includes('user-a-fixture'));
 await request('/api/projects',{name:'Only A sees this'},ca);
 assert.equal((await request('/api/state',undefined,cb)).data.projects.length,0);
 assert.equal((await request('/api/codex/connect',{},ca)).response.status,400);
 await request('/api/account/logout',{},ca);assert.equal((await request('/api/state',undefined,ca)).response.status,401);
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByLabel('Email',{exact:true}).fill('b@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password-b');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Integrations',exact:false}).click();
  await page.getByLabel('Agent provider',{exact:true}).selectOption('anthropic');
  assert.equal(await page.getByRole('button',{name:'Connect Codex',exact:true}).isVisible(),false);
  assert.equal(await page.getByLabel('Your provider API key',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  fs.mkdirSync('.review-work/studio',{recursive:true});await page.screenshot({path:'.review-work/studio/accounts-mobile.png',fullPage:true});
 }finally{await browser.close()}
 console.log('Two-account isolation smoke passed: separate real worker processes, credentials, projects, sign-out and hosted login restriction. No external calls.');
}finally{await app.close();await new Promise(r=>app.server.close(r));}
