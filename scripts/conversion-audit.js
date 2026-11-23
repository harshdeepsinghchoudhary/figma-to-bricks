import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateNormalized} from './normalized-validator.js';
import {validateBuild} from './validate-build.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export function auditSection(normalized,tree,map,manifest){
 const issues=validateNormalized(normalized,manifest).errors.map(description=>({severity:'error',kind:'normalized-schema',description}));
 const allText=plain(tree.map(e=>e.settings?.text||e.settings?.label||'').join(' '));
 const byNormalized=new Map();for(const e of tree){const id=map[e.id]?.normalizedId;if(id)byNormalized.set(id,e);}
 function walk(n){
  const text=plain(n.text);
  if(text&&['heading','text','button','link'].includes(n.type)&&!allText.includes(text))issues.push({severity:'error',kind:'content-mapping',node:n.id,description:'Normalized text not found verbatim in compiled elements; resolve the mapping before import',expected:text});
  const e=byNormalized.get(n.id);
  if(e&&typeof n.size?.width==='number'&&['block','container','row','column'].includes(n.type)&&!e.settings?._width&&!e.settings?._widthMax)issues.push({severity:'warning',kind:'lost-width',node:n.id,elementId:e.id,expected:n.size.width,description:'Measured normalized width has no direct compiled width/max-width; inspect layout inheritance.'});
  for(const c of n.children||[])walk(c);
 }walk(normalized);
 for(const e of tree){for(const [side,value] of Object.entries(e.settings?._padding||{})){if(Number.parseFloat(value)<0)issues.push({severity:'error',kind:'invalid-padding',elementId:e.id,description:`Negative ${side} padding`});}}
 return issues;
}
export function auditConversion(frame){
 const merged=path.join(frame,'merged'),sections=read(path.join(merged,'section-map.json'));
 const checks=sections.map(s=>{const dir=path.join(frame,'sections',s.name);return {section:s.name,issues:auditSection(read(path.join(dir,'normalized.json')),read(path.join(dir,'bricks-tree.json')),read(path.join(dir,'bricks-source-map.json')),read(path.join(frame,'asset-manifest.json')))};});
 const validation=validateBuild(read(path.join(merged,'bricks-tree.json')),merged);
 const errors=[...validation.errors,...checks.flatMap(s=>s.issues.filter(i=>i.severity==='error').map(i=>`${s.section}: ${i.description}`))];
 const report={status:errors.length?'blocked':'checked',errors,sections:checks,visualAcceptance:false,note:'Static audit detects structural and mapping problems; warnings require review, not blind JSON patches.'};
 fs.writeFileSync(path.join(merged,'conversion-audit.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const r=auditConversion(process.argv[2]);console.log(`Pre-import JSON audit: ${r.errors.length} errors, ${r.sections.reduce((n,s)=>n+s.issues.length,0)} findings.`);if(r.errors.length){console.error(r.errors.join('\n'));process.exitCode=1;}}catch(e){console.error(e.message);process.exitCode=1;}
}
