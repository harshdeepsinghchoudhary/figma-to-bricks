import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {verifyDraft,runScript} from '../studio/autopilot-worker.js';
const [frameArg,outArg]=process.argv.slice(2);
if(!frameArg||!outArg)throw Error('Usage: verify-draft.js <frame> <report-directory>');
const frame=path.resolve(frameArg),merged=path.join(frame,'merged'),outDir=path.resolve(outArg);
fs.mkdirSync(outDir,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(merged,name),'utf8'));
try{
 const result=await verifyDraft({input:{outDir,iterations:2,widths:[1024,390],target:.08},frame,merged,sections:read('section-map.json'),injection:read('inject-report.json')},{run:(script,args)=>runScript(process.cwd(),script,args)});
 if(!result.frontendVerified)process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}
