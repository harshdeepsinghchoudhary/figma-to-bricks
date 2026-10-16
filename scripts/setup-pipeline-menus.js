import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {discoverMenus,provisionMenus} from './pipeline-menus.js';
const dir=process.argv[2];
const read=(file,fallback)=>fs.existsSync(path.join(dir,file))?JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')):fallback;
const {tree,sourceMap}=read('merged/menu-source.json',{});
if(!tree)throw new Error('Menu discovery requires the current merged source tree');
const controls=read('menu-controls.json',[]);
const plans=discoverMenus(tree,sourceMap,controls);
if(!plans.length){console.log('No source-backed WordPress menus detected.');process.exit(0);}
if(!process.env.WP_API_URL || !process.env.WP_API_USERNAME || !process.env.WP_API_PASSWORD)throw new Error('Missing in .env: WordPress API URL or credentials');
const site=process.env.WP_API_URL.split('/wp-json')[0].replace(/\/$/,'');
const headers={Authorization:'Basic '+Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64'),'Content-Type':'application/json'};
async function api(route,body){
  const response=await fetch(`${site}/wp-json/wp/v2/${route}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok){const error=new Error(`WordPress menu API: ${response.status} ${data.code || 'request failed'}`);error.code=data.code;error.status=response.status;throw error;}
  return data;
}
const previous=read('wordpress-menus.json',[]);
// Adopt legacy bindings only after comparing their items with source evidence.
if(!previous.length){
  const footers=read('footer-menus.json',[]);
  for(const plan of plans){
    const id=plan.control?.wordpressMenuId || footers.find(b=>b.list===plan.key)?.menuId;
    if(!id)continue;
    const menus=await api(`menus?include=${id}&context=edit`);
    if(!menus.length)continue;
    const items=await api(`menu-items?menus=${id}&per_page=100&context=edit`);
    if(plan.items.every(title=>items.some(i=>(i.title.raw || i.title.rendered)===title)))previous.push({...plan,site,slug:menus[0].slug});
  }
}
const bindings=await provisionMenus(plans,{api,site,frame:path.basename(dir),previous});
fs.writeFileSync(path.join(dir,'wordpress-menus.json'),JSON.stringify(bindings,null,2));
fs.writeFileSync(path.join(dir,'footer-menus.json'),JSON.stringify(bindings.filter(b=>b.role==='footer'),null,2));
for(const b of bindings.filter(b=>b.control))b.control.wordpressMenuId=b.menuId;
fs.writeFileSync(path.join(dir,'menu-controls.json'),JSON.stringify(controls,null,2));
console.log(`Pipeline menus ready: ${bindings.length}; header breakpoint 1024px; footer menus stay expanded.`);
