import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateBuild} from '../scripts/validate-build.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function sectionElementIds(tree,section){
 const ids=new Set(section.rootIds||[]);
 let changed=true;
 while(changed){changed=false;for(const e of tree)if(ids.has(e.parent)&&!ids.has(e.id)){ids.add(e.id);changed=true;}}
 return ids;
}
export function spliceSection(before,after,oldSection,newSection){
 const oldIds=sectionElementIds(before,oldSection),newIds=sectionElementIds(after,newSection);
 if(!oldIds.size||!newIds.size)throw Error('Repair candidate lost its section roots.');
 const outside=new Set(before.filter(e=>!oldIds.has(e.id)).map(e=>e.id));
 if([...newIds].some(id=>outside.has(id)))throw Error('Repair candidate collides with another section.');
 const replacement=after.filter(e=>newIds.has(e.id));
 let inserted=false;const result=[];
 for(const e of before){if(oldIds.has(e.id)){if(!inserted){result.push(...replacement);inserted=true;}}else result.push(structuredClone(e));}
 return result;
}
export function runCompilerScript(script,args,{timeoutMs=120000}={}){
 if(!['3_compile_bricks.js','merge_sections.js'].includes(script))throw Error('Unsupported repair compiler command');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root,env:process.env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let log='',done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(log);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Repair compiler timed out'));},timeoutMs);
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b.toString()).slice(-100000);});
  child.on('error',finish);child.on('close',code=>finish(code?Error(`${script} failed (${code}): ${log.slice(-5000)}`):null));
 });
}
export async function compileRootCandidate({frame,dir,section,normalized,best,treeDir,run=runCompilerScript}){
 if(!/^section-[a-z0-9-]+$/i.test(section.name))throw Error('Invalid section name');
 const source=fs.realpathSync(frame),target=path.resolve(dir);
 if(target===source||target.startsWith(source+path.sep))throw Error('Repair workspace must be outside the source frame');
 if(fs.existsSync(target))throw Error('Repair workspace already exists');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.cpSync(source,target,{recursive:true,dereference:false,filter:p=>{
  if(fs.lstatSync(p).isSymbolicLink())throw Error('Repair workspace cannot follow source symlinks');
  return !['runs','parts','.agent-session'].includes(path.basename(p));
 }});
 const normalizedFile=path.join(target,'sections',section.name,'normalized.json');
 fs.writeFileSync(normalizedFile,JSON.stringify(normalized,null,2));
 let log='';
 try{
  log+=await run('3_compile_bricks.js',[path.dirname(normalizedFile)]);
  log+=await run('merge_sections.js',[target,...best.sectionMap.map(s=>s.name)]);
 }catch(error){log+='\n'+error.message;throw error;}finally{fs.writeFileSync(path.join(target,'repair-compile.log'),log);}
 const merged=path.join(target,'merged'),sectionMap=read(path.join(merged,'section-map.json'));
 const nextSection=sectionMap.find(s=>s.name===section.name);
 if(!nextSection)throw Error('Recompiled section is absent');
 const compiled=read(path.join(merged,'bricks-tree.json'));
 // Only new section settings need their local asset paths rebased. Other
 // sections retain their exact existing settings, including prior repairs.
 const newIds=sectionElementIds(compiled,nextSection);
 function rebase(value){if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){
  if(['url','full'].includes(key)&&typeof v==='string'&&!/^(?:https?:|data:|\/\/|#)/i.test(v))value[key]=path.relative(treeDir,path.resolve(merged,v)).split(path.sep).join('/');
  else if(v&&typeof v==='object')rebase(v);
 }}
 for(const e of compiled)if(newIds.has(e.id))rebase(e.settings);
 const tree=spliceSection(best.tree,compiled,section,nextSection);
 const validation=validateBuild(tree,treeDir);
 fs.writeFileSync(path.join(target,'repair-validation.json'),JSON.stringify(validation,null,2));
 if(validation.errors.length)throw Error('Recompiled candidate failed validation: '+validation.errors.join('; '));
 const oldIds=sectionElementIds(best.tree,section),sourceMap={...best.sourceMap};
 for(const id of oldIds)delete sourceMap[id];
 const compiledMap=read(path.join(merged,'bricks-source-map.json'));
 for(const id of newIds)if(compiledMap[id])sourceMap[id]=compiledMap[id];
 const maps=best.sectionMap.map(s=>s.name===section.name?nextSection:s);
 return {tree,normalized,sourceMap,sectionMap:maps,candidateDir:target};
}
