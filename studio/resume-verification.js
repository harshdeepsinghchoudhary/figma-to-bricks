import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyDraft,runScript,COMPILER_REVISION} from './autopilot-worker.js';
import {repairMode} from './core.js';
export async function resumeVerification(input,root=process.cwd(),verify=verifyDraft,run=(s,a)=>runScript(root,s,a)){
 if(!/^[a-f0-9-]{36}$/.test(input.priorId))throw Error('Invalid prior job');
 const prior=path.join(root,'.studio/artifacts',input.priorId);
 const report=JSON.parse(fs.readFileSync(path.join(prior,'workflow.json'),'utf8'));
 input={...input,repairMode:repairMode(input.repairMode??report.repairMode)};
 if(!report.injection?.postId||new URL(report.injection.permalink).origin!==new URL(process.env.WP_API_URL).origin)throw Error('The prior draft must belong to the currently configured website.');
 if(verify===verifyDraft)await run('check-draft-access.js',[path.join(input.outDir,'access-preflight')]);
 const work=path.join(prior,'work'),names=fs.readdirSync(work).filter(n=>fs.existsSync(path.join(work,n,'figma-node.json')));
 if(names.length!==1)throw Error('Prior job does not identify one design');
 const source=fs.realpathSync(path.join(work,names[0]));
 if(!source.startsWith(fs.realpathSync(prior)+path.sep))throw Error('Prior job source escapes its artifact directory');
 const frame=path.join(input.outDir,'work',names[0]);fs.mkdirSync(input.outDir,{recursive:true});
 fs.cpSync(source,frame,{recursive:true});const merged=path.join(frame,'merged');
 fs.writeFileSync(path.join(input.outDir,'workflow.json'),JSON.stringify({...report,status:'resuming',frontendVerified:false},null,2));
 const checkpoints=path.join(prior,'checkpoints');
 const sections=JSON.parse(fs.readFileSync(path.join(merged,'section-map.json'),'utf8'));
 if(report.compilerRevision!==COMPILER_REVISION && sections.length){
  console.log(JSON.stringify({event:'recompile-saved-normalization',stage:'recompile-saved-normalization'}));
  for(const section of sections){if(!/^section-[a-z0-9-]+$/i.test(section.name))throw Error('Invalid saved section name');await run('3_compile_bricks.js',[path.join(frame,'sections',section.name)]);}
  await run('merge_sections.js',[frame,...sections.map(s=>s.name)]);
  await run('wrap-template.js',[merged]);await run('conversion-audit.js',[frame]);
  // Explicit recorded page only: never create a second draft on retry.
  await run('4_inject_mcp.js',[merged,'--page',String(report.injection.postId),'--fix-keys','--report-dir',path.join(input.outDir,'mcp')]);
 }else if(fs.existsSync(checkpoints))fs.cpSync(checkpoints,path.join(input.outDir,'checkpoints'),{recursive:true});
 return verify({input:{...input,iterations:2,widths:[1024,390],target:.08},frame,merged,sections,injection:report.injection},{run});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let text='';for await(const chunk of process.stdin)text+=chunk;
 try{await resumeVerification(JSON.parse(text));}catch(error){console.error(error.message);process.exitCode=1;}
}
