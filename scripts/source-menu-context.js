import {inferSiteWidth} from './site-width.js';
// Derive cross-section menu context from the source, not saved output IDs.
export function sourceMenuContext(root){
 const nodes=[],parent=new Map();
 (function walk(n,p){if(n.visible===false)return;nodes.push(n);if(p)parent.set(n.id,p);for(const c of n.children||[])walk(c,n);})(root);
 const box=n=>n.absoluteBoundingBox;
 const page=box(root),nearTop=n=>box(n)&&box(n).y<page.y+Math.min(220,page.height*.12);
 const texts=n=>(n.children||[]).filter(c=>c.visible!==false&&c.type==='TEXT');
 const descendantTexts=n=>{const found=[];(function visit(x){for(const c of x.children||[]){if(c.visible===false)continue;if(c.type==='TEXT')found.push(c);else visit(c);}})(n);return found;};
 // Menu labels are often wrapped in one small frame each. Treat a child as a
 // label only when that wrapper contains exactly one short text node, which
 // avoids promoting a whole header (logo + nav + CTA) to a menu.
 const menuLabels=n=>(n.children||[]).map(child=>{
  if(child.visible===false)return null;
  if(child.type==='TEXT')return {member:child,text:child};
  const nested=descendantTexts(child);
  return nested.length===1?{member:child,text:nested[0]}:null;
 }).filter(Boolean);
 const navs=nodes.filter(n=>{
  if(!nearTop(n))return false;
  const labels=menuLabels(n);
  return labels.length>=3&&labels.every(({text})=>text.characters?.trim()&&text.characters.length<=35&&box(text))&&labels.every(({text})=>Math.abs(box(text).y+box(text).height/2-(box(labels[0].text).y+box(labels[0].text).height/2))<12);
 });
 const bars=nodes.filter(n=>nearTop(n)&&(n.children||[]).length===3&&n.children.every(c=>['RECTANGLE','LINE'].includes(c.type)&&box(c)?.width>=12&&box(c).height<=4));
 const images=nodes.filter(n=>nearTop(n)&&box(n).width<250&&box(n).height<100&&(n.fills||[]).some(f=>f.type==='IMAGE'));
 const controls=[];
 if(navs.length===1&&bars.length===1&&images.length){
  const trigger=bars[0],logo=images.sort((a,b)=>Math.abs(box(a).x-box(trigger).x)-Math.abs(box(b).x-box(trigger).x))[0];
  let header=parent.get(trigger.id);
  const contains=(a,b)=>box(a)&&box(b)&&box(a).x<=box(b).x&&box(a).y<=box(b).y&&box(a).x+box(a).width>=box(b).x+box(b).width&&box(a).y+box(a).height>=box(b).y+box(b).height;
  while(header&&header!==root&&(!contains(header,logo)||box(header).width<page.width*.4))header=parent.get(header.id);
  const content=parent.get(navs[0].id);
  if(header&&header!==root&&content&&content!==root&&!contains(header,navs[0]))controls.push({trigger:trigger.id,logo:logo.id,header:header.id,navigation:navs[0].id,content:content.id,breakpoint:1024});
 }
 const footerIds=new Set();
 for(const n of nodes){
  if(!box(n)||box(n).y<page.y+page.height*.8)continue;
  if(/footer/i.test(n.name||'')||(texts(n).length===2&&texts(n)[0].characters?.length<60&&/\n/.test(texts(n)[1].characters||''))){
   for(let p=n;p&&p!==root&&box(p)?.y>=page.y+page.height*.8;p=parent.get(p.id))footerIds.add(p.id);
  }
 }
 return {controls,navIds:new Set(navs.map(n=>n.id)),footerIds,parent};
}
export function annotateMenuContext(sourceMap,root){
 const context=sourceMenuContext(root);
 const inset=Math.max(0,(root.absoluteBoundingBox.width-inferSiteWidth(root))/2);
 for(const entry of Object.values(sourceMap)){
  if(context.navIds.has(entry.figmaNodeId)){
   entry.normalizedId='header-navigation-'+(entry.normalizedId||'');
   const parent=context.parent.get(entry.figmaNodeId),source=parent?.children?.find(n=>n.id===entry.figmaNodeId);
   if(source?.absoluteBoundingBox.width>=root.absoluteBoundingBox.width*.99)entry.headerPageInset=inset;
  }
  for(let id=entry.figmaNodeId;id;id=context.parent.get(id)?.id)if(context.footerIds.has(id)){entry.normalizedId='footer-'+(entry.normalizedId||'');break;}
 }
 return context.controls;
}
