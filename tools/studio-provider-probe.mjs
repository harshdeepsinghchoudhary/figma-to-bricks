// Explicit, small paid-provider smoke test. This is not a design conversion.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {propose} from '../studio/agent.js';
const engine=process.argv[2];
if(!['api','codex'].includes(engine))throw Error('Usage: node tools/studio-provider-probe.mjs api|codex');
const workDir=path.resolve('.studio/provider-probe');fs.mkdirSync(workDir,{recursive:true});
const image=path.join(workDir,'fixture.png');
await sharp({create:{width:64,height:64,channels:3,background:'#336699'}}).png().toFile(image);
try{
 const result=await propose({engine,workDir,timeoutMs:60000,images:[image],ids:new Set(['fixture']),prompt:'This is a connection test fixture, not a real design. The image is a blue square. Return ONLY JSON {"issues":[],"patches":[]}. Do not use tools.'});
 console.log(JSON.stringify({engine,status:'passed',fixture:true,issues:result.issues.length,patches:result.patches.length}));
}catch(e){
 let message=String(e.message);for(const [key,value] of Object.entries(process.env))if(/TOKEN|PASSWORD|SECRET|API_KEY/.test(key)&&value?.length>3)message=message.split(value).join('[redacted]');
 console.error(JSON.stringify({engine,status:'failed',fixture:true,error:message.slice(0,1500)}));process.exitCode=1;
}
