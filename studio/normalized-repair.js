import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {validateNormalized} from '../scripts/normalized-validator.js';
import {reconcileFigmaProperties} from '../scripts/figma-preservation.js';
import {isGraphicNode,hasImageFill} from '../scripts/graphic-detect.js';

const sourceSchema=JSON.parse(fs.readFileSync(new URL('../schema/normalized-schema.json',import.meta.url),'utf8'));
const definitions=structuredClone(Object.fromEntries(['hex','cssUnitValue','px','sides','layout','size','background','gradient','border','boxShadow','typography','styleOverride'].map(k=>[k,sourceSchema.definitions[k]])));
const STYLE_FIELDS=['layout','size','typography','background','border','boxShadow','responsive'];
const BREAKPOINTS=['tablet_portrait','mobile_landscape','mobile_portrait'];
const CONTAINERS=new Set(['section','container','row','column','block']);
const id={type:'string',pattern:'^[a-z0-9]+(-[a-z0-9]+)*$',maxLength:100};
const sourceId={type:'string',minLength:1,maxLength:100};
const index={type:'integer',minimum:0,maximum:20000};
// The ordinary normalized schema accepts raw CSS size strings for trusted
// compiler input. Runtime repairs intentionally accept only simple lengths.
for(const value of Object.values(definitions.size.properties)){
 for(const option of value.anyOf||[])if(option.type==='string')Object.assign(option,{pattern:'^(?:fill|hug|auto|[0-9]+(?:\\.[0-9]+)?(?:px|%|rem|vw|vh))$',maxLength:40});
}
definitions.border.properties.color={$ref:'#/definitions/hex'};
definitions.typography.properties.fontFamily={type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9 _-]+$'};
const style={type:'object',additionalProperties:false,minProperties:1,properties:Object.fromEntries(STYLE_FIELDS.filter(k=>k!=='responsive').map(k=>[k,{$ref:`#/definitions/${k}`}]))};
style.properties.responsive={type:'object',additionalProperties:false,minProperties:1,properties:Object.fromEntries(BREAKPOINTS.map(k=>[k,{$ref:'#/definitions/styleOverride'}]))};
const operation=(op,required,properties)=>({type:'object',additionalProperties:false,required:['op',...required],properties:{op:{const:op},...properties}});
export const NORMALIZED_REPAIR_SCHEMA={
 type:'array',maxItems:30,definitions,items:{oneOf:[
  operation('set',['id'],{id,set:style,unset:{type:'array',minItems:1,maxItems:STYLE_FIELDS.length,uniqueItems:true,items:{enum:STYLE_FIELDS}}}),
  operation('move',['id','parentId','index'],{id,parentId:id,index}),
  operation('group',['id','parentId','childIds','type'],{id,parentId:id,childIds:{type:'array',minItems:2,maxItems:50,uniqueItems:true,items:id},type:{enum:['row','column','block']},layout:{$ref:'#/definitions/layout'}}),
  operation('restore',['id','sourceId','parentId','index'],{id,sourceId,parentId:id,index})
 ]}
};
const validatePatches=new Ajv({allErrors:true,strict:false}).compile(NORMALIZED_REPAIR_SCHEMA);
export const NORMALIZED_REPAIR_PROMPT=`Return patches using normalized node IDs, never Bricks IDs:
{"op":"set","id":"node-id","set":{"layout":{"gap":24},"size":{"width":"fill"}},"unset":["size"]} merges allowed style fields. Omit unset unless needed. Allowed fields: ${STYLE_FIELDS.join(', ')}. Responsive keys: ${BREAKPOINTS.join(', ')}. Sizes are finite numbers or simple fill/hug/auto/px/%/rem/vw/vh lengths; no CSS expressions.
{"op":"move","id":"existing-node","parentId":"existing-container","index":0} moves a node; index is its position after removal. Never move a section or create a cycle.
{"op":"group","id":"new-kebab-id","parentId":"existing-container","childIds":["first","second"],"type":"row","layout":{"direction":"row","gap":24}} groups contiguous siblings in their current order. Do not regroup native component internals.
{"op":"restore","id":"new-kebab-id","sourceId":"12:345","parentId":"existing-container","index":0} restores missing visible source text or an already exported text-free graphic. Content and assets are copied deterministically from Figma, never supplied by the model. Missing wrappers/complex unsupported elements require a compiler-rule proposal.
No operations may set IDs, Figma metadata, URLs, HTML, CSS, scripts, assets, component internals or original source data. Source-derived measurements override guesses during recompilation; report unsupported mappings instead of trying to bypass them. Maximum 30 operations.`;

function safePayload(value,depth=0,state={count:0}){
 if(++state.count>5000)throw Error('Normalized repair payload exceeds the value limit.');
 if(depth>12)throw Error('Normalized repair payload is too deeply nested.');
 if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>100000))throw Error('Normalized repair numbers must be finite and bounded.');
 if(typeof value==='string'&&value.length>500)throw Error('Normalized repair string exceeds the limit.');
 if(value&&typeof value==='object'){
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('Normalized repair must contain plain JSON objects.');
  for(const [key,child] of Object.entries(value)){
   if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe normalized repair key.');
   safePayload(child,depth+1,state);
  }
 }
}
function merge(target,patch){
 for(const [key,value] of Object.entries(patch)){
  if(value&&typeof value==='object'&&!Array.isArray(value)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};merge(target[key],value);}
  else target[key]=structuredClone(value);
 }
}
function treeIndex(doc){
 const nodes=new Map(),parents=new Map(),objects=new Set();let count=0;
 function visit(node,parent,depth){
  if(!node||typeof node!=='object'||objects.has(node)||depth>100||++count>20000)throw Error('Normalized tree contains a cycle, shared node, or exceeds limits.');
  objects.add(node);
  if(node!==doc){if(typeof node.id!=='string'||nodes.has(node.id))throw Error('Normalized tree requires unique node IDs.');nodes.set(node.id,node);parents.set(node.id,parent);}
  if(node.children!==undefined&&!Array.isArray(node.children))throw Error('Normalized children must be an array.');
  for(const child of node.children||[])visit(child,node,depth+1);
 }
 visit(doc,null,0);return {nodes,parents};
}
function sourceIndex(rawRoot,sectionSourceId){
 const nodes=new Map(),parents=new Map(),visible=new Set(),scope=new Set();const objects=new Set();
 function visit(node,parent,shown,inside,depth){
  if(!node||objects.has(node)||depth>100||nodes.size>50000||typeof node.id!=='string'||nodes.has(node.id))throw Error('Invalid Figma source tree.');
  objects.add(node);nodes.set(node.id,node);parents.set(node.id,parent);shown&&=node.visible!==false;inside||=node.id===sectionSourceId;
  if(shown)visible.add(node.id);if(inside)scope.add(node.id);
  for(const child of node.children||[])visit(child,node,shown,inside,depth+1);
 }
 visit(rawRoot,null,true,false,0);
 if(!scope.size)throw Error('Selected source section does not exist.');
 return {nodes,parents,visible,scope};
}

/** Apply only bounded, source-scoped operations to a clone of saved normalization. */
export function applyNormalizedRepairs(doc,patches,{rawRoot,sectionSourceId,manifest=[],assetBaseDir}={}){
 safePayload(patches);
 if(!validatePatches(patches))throw Error('Invalid normalized repair: '+validatePatches.errors.map(e=>`${e.instancePath} ${e.message}`).join('; '));
 if(!rawRoot||!sectionSourceId)throw Error('Normalized repair requires the original Figma section.');
 const raw=sourceIndex(rawRoot,sectionSourceId);
 treeIndex(doc);
 const result=structuredClone(doc);
 const validate=()=>{
  const indexed=treeIndex(result);
  for(const node of indexed.nodes.values())for(const ref of [node.figmaNodeId,node.asset?.nodeId])if(ref&&raw.nodes.has(ref)&&!raw.scope.has(ref))throw Error('Normalized repair contains an out-of-section source node.');
  const checked=validateNormalized(result,manifest);if(checked.errors.length)throw Error('Normalized repair failed validation: '+checked.errors.join('; '));
  return indexed;
 };
 validate();
 for(const patch of patches){
  const {nodes,parents}=treeIndex(result),node=nodes.get(patch.id),parent=nodes.get(patch.parentId);
  const requireNode=()=>{if(!node)throw Error(`Unknown normalized node ${patch.id}.`);return node;};
  const requireParent=()=>{if(!parent||!CONTAINERS.has(parent.type)||parent.component)throw Error('Repair target must be an existing plain container.');return parent;};
  const protectedByComponent=n=>{for(let p=n;p&&p!==result;p=parents.get(p.id))if(p.component)return true;return false;};
  if(patch.op==='set'){
   requireNode();if(!patch.set&&!patch.unset)throw Error('Set repair must contain a change.');
   for(const field of patch.unset||[])delete node[field];
   if(patch.set)merge(node,patch.set);
  }else if(patch.op==='move'){
   requireNode();requireParent();if(node.type==='section'||!parents.get(node.id)||parents.get(node.id)===result)throw Error('Section roots cannot be moved.');
   if(protectedByComponent(node)||protectedByComponent(parent))throw Error('Native component structure cannot be moved.');
   for(let p=parent;p&&p!==result;p=parents.get(p.id))if(p===node)throw Error('Move would create a normalized cycle.');
   const old=parents.get(node.id);old.children.splice(old.children.indexOf(node),1);
   parent.children||=[];if(patch.index>parent.children.length)throw Error('Move index is outside the destination.');parent.children.splice(patch.index,0,node);
  }else if(patch.op==='group'){
   requireParent();if(node)throw Error('Group ID already exists.');if(protectedByComponent(parent))throw Error('Native component structure cannot be regrouped.');
   const children=parent.children||[],positions=patch.childIds.map(childId=>children.findIndex(c=>c.id===childId));
   if(positions.some((position,i)=>position<0||i>0&&position!==positions[0]+i))throw Error('Group requires contiguous siblings in their original order.');
   const grouped=positions.map(position=>children[position]);if(grouped.some(n=>n.type==='section'||n.component))throw Error('Section or native component roots cannot be regrouped.');
   const group={id:patch.id,type:patch.type,children:grouped,...(patch.layout?{layout:structuredClone(patch.layout)}:{})};
   children.splice(positions[0],grouped.length,group);
  }else if(patch.op==='restore'){
   requireParent();if(node)throw Error('Restored node ID already exists.');if(protectedByComponent(parent))throw Error('Native component structure cannot be restored here.');
   const source=raw.nodes.get(patch.sourceId);if(!source||!raw.scope.has(source.id)||!raw.visible.has(source.id))throw Error('Restoration source is outside the selected visible section.');
   const descendants=new Set();(function walk(n){descendants.add(n.id);for(const c of n.children||[])walk(c);})(source);
   for(const existing of nodes.values()){
    const ref=existing.figmaNodeId||existing.asset?.nodeId;
    if(descendants.has(ref)||descendants.has(existing.asset?.nodeId))throw Error('Restoration would duplicate represented source content.');
    for(let p=raw.parents.get(source.id);p;p=raw.parents.get(p.id)){
     if(existing.asset?.nodeId===p.id||existing.type==='button'&&ref===p.id&&existing.text===source.characters)throw Error('Restoration source is already covered by an exported graphic or button.');
    }
   }
   let restored;
   if(source.type==='TEXT'&&typeof source.characters==='string')restored={id:patch.id,type:'text',figmaNodeId:source.id,text:source.characters};
   else{
    const asset=manifest.find(a=>a.nodeId===source.id),graphic=isGraphicNode(source);
    const textFree=n=>n.type!=='TEXT'&&(n.children||[]).filter(c=>c.visible!==false).every(textFree);
    if(!asset||!textFree(source)||!(graphic.isGraphic||graphic.composite||hasImageFill(source)&&!source.children?.length))throw Error('Only missing source text or exported text-free graphics can be restored. Record a compiler-rule proposal for this source.');
    if(typeof asset.file!=='string'||asset.file.includes('\0')||/^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i.test(asset.file)&&!/^[a-z]:[/\\]/i.test(asset.file)||!['.svg','.png','.jpg','.jpeg','.webp','.gif','.avif'].includes(path.extname(asset.file).toLowerCase()))throw Error('Restoration requires a local exported image file.');
    if(assetBaseDir){
     const file=path.resolve(assetBaseDir,asset.file);let stat;
     try{stat=fs.lstatSync(file);}catch{throw Error('Restoration asset file is missing. Re-extract it before repair.');}
     if(!stat.isFile()||stat.isSymbolicLink())throw Error('Restoration asset must be a regular file, not a directory or symbolic link.');
    }
    if(!source.absoluteBoundingBox||![source.absoluteBoundingBox.width,source.absoluteBoundingBox.height].every(v=>Number.isFinite(v)&&v>0))throw Error('Restoration graphic has no valid source dimensions.');
    restored={id:patch.id,type:'image',figmaNodeId:source.id,asset:{nodeId:source.id,kind:/\.svg$/i.test(asset.file||'')?'svg':'image'},size:{width:source.absoluteBoundingBox.width,height:source.absoluteBoundingBox.height}};
   }
   reconcileFigmaProperties({type:'page',children:[restored]},rawRoot,{manifest});
   parent.children||=[];if(patch.index>parent.children.length)throw Error('Restore index is outside the destination.');parent.children.splice(patch.index,0,restored);
  }
  validate();
 }
 return result;
}
