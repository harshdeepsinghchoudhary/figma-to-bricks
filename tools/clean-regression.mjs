// Rebuild from extracted source/assets only: no normalized cache or bindings.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const base=path.resolve('.review-work',`clean-regression-${Date.now()}`);
fs.mkdirSync(base,{recursive:true});
const results=[];
const requested=process.argv.slice(2);
for(const name of requested.length?requested:fs.readdirSync('output')){
 const source=path.resolve('output',name);
 if(!fs.existsSync(path.join(source,'figma-node.json')))continue;
 const target=path.join(base,name);fs.mkdirSync(target,{recursive:true});
 for(const file of ['figma-node.json','figma-file-metadata.json','extract-source.json'])if(fs.existsSync(path.join(source,file)))fs.copyFileSync(path.join(source,file),path.join(target,file));
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'asset-manifest.json'),'utf8'));
 fs.writeFileSync(path.join(target,'asset-manifest.json'),JSON.stringify(manifest.map(a=>({...a,file:path.resolve(source,a.file)}))));
 const run=spawnSync(process.execPath,['scripts/pipeline.js','--frame',target,'--deterministic','--no-inject','--no-dataset'],{encoding:'utf8',maxBuffer:30*1024*1024});
 fs.writeFileSync(path.join(target,'clean-build.log'),(run.stdout||'')+(run.stderr||''));
 results.push({name,exitCode:run.status,target,error:run.status?((run.stdout||'')+(run.stderr||'')).slice(-2500):null});
 console.log(`${name}: ${run.status===0?'PASS':'FAIL'} ${target}`);
 fs.writeFileSync(path.join(base,'report.json'),JSON.stringify(results,null,2));
}
console.log(`Report: ${base}/report.json`);process.exitCode=results.some(r=>r.exitCode)?1:0;
