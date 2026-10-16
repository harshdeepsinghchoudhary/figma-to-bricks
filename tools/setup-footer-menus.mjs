import 'dotenv/config';
import fs from 'node:fs';
import {discoverFooterMenus} from '../scripts/footer-menus.js';
const dir='output/pgslot-thailand-com-84cdd226';
const site=process.env.WP_API_URL.split('/wp-json')[0],headers={Authorization:'Basic '+Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64'),'Content-Type':'application/json'};
async function api(route,body){const r=await fetch(`${site}/wp-json/wp/v2/${route}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(`${route}: ${r.status} ${data.code}`);return data;}
const bindings=discoverFooterMenus(JSON.parse(fs.readFileSync(dir+'/merged/bricks-tree.json')),JSON.parse(fs.readFileSync(dir+'/merged/bricks-source-map.json')));
if(!bindings.length)throw new Error('No unconverted footer lists found');
for(const b of bindings){
 const slug='pgslot-footer-'+b.list.replace(':','-');
 let menu=(await api(`menus?slug=${slug}&context=edit`))[0];
 if(!menu)menu=await api('menus',{name:'PG Slot Footer - '+b.title,slug});
 const existing=await api(`menu-items?menus=${menu.id}&per_page=100&context=edit`);
 for(const [i,title] of b.items.entries())if(!existing.some(e=>(e.title.raw||e.title.rendered)===title))await api('menu-items',{title,type:'custom',url:'#',menus:menu.id,menu_order:i+1,status:'publish'});
 b.menuId=menu.id;console.log(`${menu.name}: ${b.items.length} items, ID ${menu.id}`);
}
fs.writeFileSync(dir+'/footer-menus.json',JSON.stringify(bindings,null,2));
