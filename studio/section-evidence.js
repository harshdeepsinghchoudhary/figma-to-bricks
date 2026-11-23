import sharp from 'sharp';
import path from 'node:path';
import {compare} from './visual.js';
export async function sectionEvidence({reference,actual,dir,width,sourceBox,rootBox,metrics,ids}){
 const items=metrics.elements.filter(e=>ids.has(e.id)&&e.width>0&&e.height>0);
 if(!items.length||!sourceBox)throw Error('No section geometry available for comparison');
 const y=Math.max(0,Math.floor(Math.min(...items.map(e=>e.y))));
 const bottom=Math.ceil(Math.max(...items.map(e=>e.y+e.height)));
 const ref=await sharp(reference).resize({width}).toBuffer(),rm=await sharp(ref).metadata(),am=await sharp(actual).metadata();
 const sy=Math.max(0,Math.round(sourceBox.y-rootBox.y)),sh=Math.min(Math.round(sourceBox.height),rm.height-sy),ah=Math.min(bottom-y,am.height-y);
 if(sh<=0||ah<=0)throw Error('Section lies outside screenshot bounds');
 const referenceCrop=path.join(dir,'reference-section.png'),actualCrop=path.join(dir,'actual-section.png');
 await sharp(ref).extract({left:0,top:sy,width:rm.width,height:sh}).png().toFile(referenceCrop);
 await sharp(actual).extract({left:0,top:y,width:am.width,height:ah}).png().toFile(actualCrop);
 const diff=await compare(referenceCrop,actualCrop,dir);
 return {...diff,referenceCrop,actualCrop};
}

export function compactReviewContext(elements,source,metrics){
 const allowed=key=>/^_(display|direction|flex|align|justify|grid|rowGap|columnGap|gap|padding|margin|width|height|position|top|right|bottom|left|overflow|zIndex|typography|border|background|gradient|objectFit)/.test(key)&&key!=='_cssCustom';
 const settings=e=>Object.fromEntries(Object.entries(e.settings||{}).filter(([k])=>allowed(k)).flatMap(([k,v])=>{
   if(k.startsWith('_background')){const {image,...paint}=v||{};return Object.keys(paint).length?[[k,paint]]:[];}return [[k,v]];
 }));
 return {elements:elements.map(e=>({id:e.id,name:e.name,parent:e.parent,settings:settings(e)})),source,metrics};
}
