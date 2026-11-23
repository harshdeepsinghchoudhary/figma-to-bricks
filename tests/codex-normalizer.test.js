import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {callCodex} from '../scripts/codex-normalizer.js';
test('Codex receives normalization text, screenshot and repair turns in isolated read-only runtime',async()=>{
 let home;
 class FakeRuntime {
  constructor(options){home=options.env.CODEX_HOME;assert.equal(options.config.features.shell_tool,false);assert.equal(options.env.WP_PASSWORD,undefined);}
  startThread(options){assert.equal(options.sandboxMode,'read-only');return {run:async(input,{signal})=>{
   assert.ok(signal);assert.ok(input.some(p=>p.text==='source measurements'));
   assert.ok(input.some(p=>p.text==='validation repair'));
   const image=input.find(p=>p.type==='local_image');assert.equal(fs.readFileSync(image.path,'utf8'),'fixture');
   return {finalResponse:'{"type":"page","children":[]}'};
  }}}
 }
 const r=await callCodex([{role:'user',content:[{type:'text',text:'source measurements'},{type:'image',data:Buffer.from('fixture').toString('base64')}]},{role:'user',content:'validation repair'}],{},FakeRuntime);
 assert.equal(JSON.parse(r.text).type,'page');assert.equal(fs.existsSync(home),false);
});
test('Codex empty responses fail and remove isolated session',async()=>{
 let home;class Empty {constructor(o){home=o.env.CODEX_HOME}startThread(){return {run:async()=>({finalResponse:''})}}}
 await assert.rejects(callCodex([],{},Empty),/no normalized data/);assert.equal(fs.existsSync(home),false);
});
