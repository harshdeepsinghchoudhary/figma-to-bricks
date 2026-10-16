import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {connectReadOnlyBricks} from '../scripts/bricks-mcp-readonly.js';
const dir='output/pgslot-thailand-com-84cdd226/merged', out='.review-work/pgslot-live';
const tree=JSON.parse(fs.readFileSync(dir+'/bricks-tree.json'));
const cache=Object.entries(JSON.parse(fs.readFileSync('output/mcp-media-cache.json')));
function media(obj){if(!obj||typeof obj!=='object')return; if(typeof obj.url==='string'&&!/^(https?:|data:)/.test(obj.url)){
 const abs=path.resolve(dir,obj.url), hit=cache.filter(([k])=>k.startsWith(abs+'|')||k.includes('|'+abs+'|')).at(-1)?.[1];
 if(!hit)throw new Error('No uploaded media for '+obj.url);
 Object.assign(obj,hit,{full:hit.url,size:'full'});
}for(const value of Object.values(obj))if(value&&typeof value==='object')media(value);}
media(tree);fs.writeFileSync(out+'/candidate-tree.json',JSON.stringify(tree,null,2));
const client=await connectReadOnlyBricks();
const rendered=await client.call('bricks/render-elements',{postId:3927,elements:tree});
const expandedTree=structuredClone(tree);
for(const n of expandedTree)if(['slider-nested','accordion-nested','offcanvas','nav-nested'].includes(n.name)){n.name='block';n.settings=Object.fromEntries(Object.entries(n.settings).filter(([k])=>k.startsWith('_')));}
const expanded=await client.call('bricks/render-elements',{postId:3927,elements:expandedTree});
function outer(html,id){const start=new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bid=["']brxe-${id}["'][^>]*>`,'i').exec(html);if(!start)throw new Error('No markup '+id);const re=new RegExp(`</?${start[1]}\\b[^>]*>`,'gi');re.lastIndex=start.index;let depth=0;for(let m;(m=re.exec(html));){depth+=m[0].startsWith('</')?-1:1;if(!depth)return html.slice(start.index,re.lastIndex);}throw new Error('Unclosed markup');}
let html=rendered.html;
for(const n of tree.filter(n=>['slider-nested','accordion-nested','offcanvas','nav-nested'].includes(n.name))){let fragment=outer(expanded.html,n.id);fragment=fragment.slice(fragment.indexOf('>')+1,fragment.lastIndexOf('</'));if(n.name==='slider-nested')for(const id of n.children)fragment=fragment.replace(new RegExp(`(id="brxe-${id}"[^>]*class=")`),'$1splide__slide ');const original=outer(html,n.id);html=html.replace(original,original.replace(/<div class="brx-nestable-children-placeholder"><\/div>/,fragment));}
fs.writeFileSync(out+'/candidate-render.json',JSON.stringify({...rendered,html},null,2));
console.log('Rendered candidate without saving; nested placeholders expanded from separately rendered Bricks blocks.');


