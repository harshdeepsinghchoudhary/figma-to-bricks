import 'dotenv/config';
import fs from 'node:fs';
import {connectReadOnlyBricks} from '../scripts/bricks-mcp-readonly.js';
const site=process.env.WP_API_URL.split('/wp-json')[0];
const headers={Authorization:'Basic '+Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64'),'Content-Type':'application/json'};
async function api(route,body){const r=await fetch(`${site}/wp-json/wp/v2/${route}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(`${route}: ${r.status} ${data.code}`);return data;}
const slug='figma-pgslot-header';
let menu=(await api(`menus?slug=${slug}&context=edit`))[0];
if(!menu)menu=await api('menus',{name:'PG Slot Header',slug});
const existing=await api(`menu-items?menus=${menu.id}&per_page=100&context=edit`);
const labels=['Home','Cricket','Live Casino','Slots','Sports','Crash','Table','Fishing','Lottery','Promotion','VIP'];
for(const [i,title] of labels.entries()){
 const found=existing.find(e=>(e.title.raw||e.title.rendered)===title);
 if(!found)await api('menu-items',{title,type:'custom',url:i===0?site+'/':'#',menus:menu.id,menu_order:i+1,status:'publish'});
}
const client=await connectReadOnlyBricks();
const schema=await client.call('bricks/get-element-schema',{elementName:'nav-menu'});
if(schema.name!=='nav-menu')throw new Error('Unexpected navigation schema');
fs.writeFileSync('schema/runtime/nav-menu.json',JSON.stringify(schema,null,2));
const manifest=JSON.parse(fs.readFileSync('schema/runtime/manifest.json'));
manifest.elements=[...new Set([...manifest.elements,'nav-menu'])];
fs.writeFileSync('schema/runtime/manifest.json',JSON.stringify(manifest,null,2));
const file='output/pgslot-thailand-com-84cdd226/menu-controls.json';
const bindings=JSON.parse(fs.readFileSync(file));bindings[0].wordpressMenuId=menu.id;
fs.writeFileSync(file,JSON.stringify(bindings,null,2));
console.log(JSON.stringify({menuId:menu.id,name:menu.name,items:(await api(`menu-items?menus=${menu.id}&per_page=100`)).length,locationAssignment:'unchanged'}));
