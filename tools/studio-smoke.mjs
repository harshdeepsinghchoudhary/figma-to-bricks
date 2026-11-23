import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createStudio} from '../studio/server.js';
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
const {server,token}=createStudio();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?token=${token}`);
 await page.getByRole('button',{name:'02 New Conversion',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#frame')?.options.length>1);
 await page.selectOption('#frame','pgslot-thailand-com-84cdd226');
 await page.selectOption('#section','section-16');
 await page.getByRole('button',{name:'Integrations',exact:false}).click();
 assert.equal(await page.getByRole('heading',{name:'Server-side configuration'}).isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Connect Codex',exact:true}).isVisible(),true);
 assert.equal(await page.getByLabel('WordPress MCP endpoint URL',{exact:true}).isVisible(),true);
 assert.equal(await page.getByLabel('Figma access token',{exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'02 New Conversion',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Convert with my agent to WordPress draft',exact:true}).isVisible(),true);
 await page.getByLabel('Conversion repair method',{exact:false}).selectOption('root-cause');
 assert.equal(await page.getByLabel('Review repair method',{exact:false}).inputValue(),'root-cause');
 // UI transport fixture only: do not launch a model or write WordPress here.
 let submitted;
 await page.route('**/api/jobs',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'11111111-1111-4111-8111-111111111111',label:'Fixture root-cause review'})});});
 await page.getByRole('button',{name:'Start review',exact:false}).click();
 assert.equal(submitted?.repairMode,'root-cause');
 await page.unroute('**/api/jobs');
 fs.mkdirSync('.review-work/studio',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await page.screenshot({path:`.review-work/studio/${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 assert.deepEqual(errors,[]);
 if(process.argv.includes('--workflow')){
  const run=async input=>{
   const job=await page.evaluate(async input=>{const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const j=await r.json();if(!r.ok)throw Error(j.error);return j;},input);
   let done;const deadline=Date.now()+180000;
   do{const state=await page.evaluate(async()=>await(await fetch('/api/state')).json());done=state.jobs.find(j=>j.id===job.id);if(done&&done.status!=='running')break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline);
   assert.equal(done?.status,'completed',done?.log);return done;
  };
  const frame='pgslot-thailand-com-84cdd226';
  await run({action:'build',frame,mode:'deterministic'});
  const capture=await run({action:'preview',frame,section:'section-16',widths:[390],iterations:0,target:.08});
  assert.ok(capture.report.history[0].metrics.length===2);
  const exported=await page.evaluate(async frame=>await(await fetch('/api/export?frame='+frame)).json(),frame);
  assert.ok(exported.content.length>100);assert.equal(exported.templateType,'section');
  console.log('Real saved-source workflow passed: backend compilation, local responsive screenshots/comparison, valid downloadable template. No Figma fetch, AI, or WordPress write.');
 }
 console.log('Studio browser smoke passed: design/section selection, settings panel, no JS errors or overflow at 1440/390. No model calls or remote writes.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
