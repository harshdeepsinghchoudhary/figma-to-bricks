import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runReview} from './review-worker.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const input=JSON.parse(raw),root=process.cwd();
try{
 let output='';
 console.log(JSON.stringify({event:'extract-normalize-compile',stage:'extract-normalize-compile'}));
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/pipeline.js'),...input.source,'--deterministic','--no-inject','--no-dataset','--force'],{cwd:root,env:process.env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});const log=d=>{output+=d.toString();process.stdout.write(d);};child.stdout.on('data',log);child.stderr.on('data',log);child.on('error',reject);child.on('close',code=>code?reject(Error('Compiler failed; agent review was not started.')):resolve());});
 const match=output.match(/Frame folder: (.+)/);if(!match)throw new Error('Compiler did not identify the source frame.');
 const frame=path.resolve(root,match[1].trim()),sections=JSON.parse(fs.readFileSync(path.join(frame,'merged/section-map.json'),'utf8'));
 const selected=sections.find(s=>s.name===input.section)||(!input.section?sections[0]:null);
 if(!selected)throw new Error('Compilation succeeded. Select a valid compiled section before starting agent repair.');
 console.log(`Agent review scope: ${selected.name}. Other sections are compiled but not visually accepted.`);
 await runReview({...input,section:selected.name,frame,engine:'codex'});
}catch(e){console.error(e.message);process.exitCode=1;}
