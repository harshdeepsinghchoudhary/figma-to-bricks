import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateBuild} from '../scripts/validate-build.js';
import {applyNormalizedRepairs,NORMALIZED_REPAIR_SCHEMA,NORMALIZED_REPAIR_PROMPT} from '../studio/normalized-repair.js';

const box=(x=0,y=0,width=300,height=40)=>({x,y,width,height});
function fixture(){
 const rawRoot={id:'page',type:'FRAME',absoluteBoundingBox:box(0,0,1200,1000),children:[
  {id:'10:1',type:'FRAME',absoluteBoundingBox:box(0,0,1200,500),children:[
   {id:'10:2',type:'TEXT',characters:'Original title',absoluteBoundingBox:box(),style:{fontFamily:'Inter',fontSize:32,fontWeight:600}},
   {id:'10:3',type:'TEXT',characters:'Original copy',absoluteBoundingBox:box(0,60),style:{fontFamily:'Inter',fontSize:16}},
   {id:'10:4',type:'TEXT',characters:'Missing source copy',absoluteBoundingBox:box(0,100),style:{fontFamily:'Inter',fontSize:18,fontWeight:400}},
   {id:'10:5',type:'RECTANGLE',absoluteBoundingBox:box(400,0,200,150),fills:[{type:'IMAGE',imageRef:'source-ref'}]},
   {id:'10:6',type:'FRAME',absoluteBoundingBox:box(0,0,200,100),children:[{id:'10:7',type:'TEXT',characters:'Editable',absoluteBoundingBox:box()}]},
   {id:'10:8',type:'TEXT',visible:false,characters:'Hidden source',absoluteBoundingBox:box()}
  ]},
  {id:'20:1',type:'FRAME',absoluteBoundingBox:box(0,500,1200,500),children:[{id:'20:2',type:'TEXT',characters:'Other section',absoluteBoundingBox:box()}]}
 ]};
 const doc={type:'page',children:[{id:'section',type:'section',figmaNodeId:'10:1',children:[
  {id:'title',type:'heading',figmaNodeId:'10:2',text:'Original title',layout:{margin:{top:12,left:20}}},
  {id:'copy',type:'text',figmaNodeId:'10:3',text:'Original copy'},
  {id:'group',type:'column',children:[{id:'existing',type:'text',text:'Existing unmodified content'}]}
 ]}]};
 return {doc,options:{rawRoot,sectionSourceId:'10:1',manifest:[{nodeId:'10:5',file:'photo.png',type:'image'},{nodeId:'10:6',file:'flattened.png',type:'image'}]}};
}
test('normalized style patches merge exact fields into a clone and retain source metadata',()=>{
 const {doc,options}=fixture(),before=structuredClone(doc);
 const result=applyNormalizedRepairs(doc,[{op:'set',id:'title',set:{layout:{margin:{left:0},padding:{left:20}},responsive:{tablet_portrait:{size:{width:'fill'}}}}}],options);
 const title=result.children[0].children[0];
 assert.deepEqual(doc,before);assert.deepEqual(title.layout.margin,{top:12,left:0});assert.equal(title.text,'Original title');assert.equal(title.figmaNodeId,'10:2');
 assert.equal(title.responsive.tablet_portrait.size.width,'fill');
});
test('group and move repairs change hierarchy without changing order or content',()=>{
 const {doc,options}=fixture();
 const result=applyNormalizedRepairs(doc,[{op:'group',id:'copy-group',parentId:'section',childIds:['title','copy'],type:'column',layout:{direction:'column',gap:20}},{op:'move',id:'existing',parentId:'copy-group',index:1}],options);
 const group=result.children[0].children[0];
 assert.deepEqual(group.children.map(c=>c.id),['title','existing','copy']);assert.equal(group.children[1].text,'Existing unmodified content');
 assert.deepEqual(result.children[0].children[1].children,[]);
});
test('restoring missing text copies content and typography directly from Figma',()=>{
 const {doc,options}=fixture(),before=structuredClone(options.rawRoot);
 const result=applyNormalizedRepairs(doc,[{op:'restore',id:'restored-copy',sourceId:'10:4',parentId:'section',index:1}],options);
 const restored=result.children[0].children[1];assert.equal(restored.text,'Missing source copy');assert.equal(restored.typography.fontSize,18);assert.equal(restored.figmaNodeId,'10:4');
 assert.deepEqual(options.rawRoot,before);assert.equal(doc.children[0].children.length,3);
});
test('missing image restoration references an existing manifest asset and keeps source dimensions',()=>{
 const {doc,options}=fixture();const result=applyNormalizedRepairs(doc,[{op:'restore',id:'restored-photo',sourceId:'10:5',parentId:'section',index:1}],options);
 const photo=result.children[0].children[1];assert.deepEqual(photo.asset,{nodeId:'10:5',kind:'image'});assert.deepEqual(photo.size,{width:200,height:150});
});
test('restored media can require a real local exported file and never accepts a remote or executable asset',()=>{
 const {doc,options}=fixture(),patches=[{op:'restore',id:'restored-photo',sourceId:'10:5',parentId:'section',index:1}];
 assert.throws(()=>applyNormalizedRepairs(doc,patches,{...options,assetBaseDir:os.tmpdir()}),/asset file is missing/);
 for(const file of ['https://example.test/photo.png','file:///photo.png','script.js','../escape.php','\\\\server\\photo.png'])assert.throws(()=>applyNormalizedRepairs(doc,patches,{...options,manifest:[{nodeId:'10:5',file}]}),/local exported image/);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'normalized-asset-'));
 try{
  fs.writeFileSync(path.join(temp,'photo.png'),'fixture image bytes');
  assert.ok(applyNormalizedRepairs(doc,patches,{...options,assetBaseDir:temp}));
  fs.mkdirSync(path.join(temp,'folder.png'));
  assert.throws(()=>applyNormalizedRepairs(doc,patches,{...options,assetBaseDir:temp,manifest:[{nodeId:'10:5',file:'folder.png'}]}),/regular file/);
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('normalized-asset-'))throw Error('Unexpected test cleanup path');
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
test('restore refuses missing exports, hidden/outside source and flattened editable content',()=>{
 const {doc,options}=fixture();const operation=sourceId=>[{op:'restore',id:'restored',sourceId,parentId:'section',index:0}];
 for(const sourceId of ['10:8','20:2','10:6','unknown'])assert.throws(()=>applyNormalizedRepairs(doc,operation(sourceId),options));
 assert.throws(()=>applyNormalizedRepairs(doc,operation('10:5'),{...options,manifest:[]}),/Only missing source text/);
});
test('restoration rejects already represented source content and descendants covered by graphics',()=>{
 const {doc,options}=fixture();assert.throws(()=>applyNormalizedRepairs(doc,[{op:'restore',id:'copy-two',sourceId:'10:3',parentId:'section',index:0}],options),/duplicate/);
 doc.children[0].children.push({id:'flat',type:'image',figmaNodeId:'10:6',asset:{nodeId:'10:6',kind:'image'}});
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'restore',id:'text-inside-flat',sourceId:'10:7',parentId:'section',index:0}],options),/already covered/);
});
test('operations reject duplicate IDs, cycles, invalid indices and reordered grouping',()=>{
 const {doc,options}=fixture();
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'group',id:'copy',parentId:'section',childIds:['title','copy'],type:'row'}],options),/already exists/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'move',id:'group',parentId:'group',index:0}],options),/cycle/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'move',id:'copy',parentId:'group',index:10}],options),/index/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'group',id:'new',parentId:'section',childIds:['copy','title'],type:'row'}],options),/original order/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'group',id:'new',parentId:'section',childIds:['title','group'],type:'row'}],options),/contiguous/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'move',id:'section',parentId:'group',index:0}],options),/Section roots/);
});
test('native component internals cannot be regrouped or moved',()=>{
 const {doc,options}=fixture();doc.children[0].children[2].component={kind:'accordion'};
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'move',id:'existing',parentId:'section',index:0}],options),/Native component/);
 assert.throws(()=>applyNormalizedRepairs(doc,[{op:'move',id:'copy',parentId:'group',index:0}],options),/plain container/);
});
test('runtime patches cannot set content, source metadata, URLs, CSS or unsafe expressions',()=>{
 const {doc,options}=fixture();
 const changes=[{text:'invented'},{asset:{nodeId:'evil',kind:'image'}},{figma:{position:{left:0}}},{_cssCustom:'body{display:none}'},{href:'https://attacker.test'},
  {size:{width:'calc(100% - 10px)'}},{border:{color:'red;display:none'}},{typography:{fontFamily:'Inter;display:none'}},{responsive:{evil:{size:{width:20}}}},{layout:{gap:Infinity}},{size:{width:100001}}];
 for(const set of changes)assert.throws(()=>applyNormalizedRepairs(doc,[{op:'set',id:'title',set}],options));
 assert.throws(()=>applyNormalizedRepairs(doc,JSON.parse('[{"op":"set","id":"title","set":{"layout":{"__proto__":{"polluted":true}}}}]'),options),/Unsafe/);
 assert.equal({}.polluted,undefined);
});
test('scope, tree and operation limits are enforced before mutation',()=>{
 const {doc,options}=fixture();
 assert.throws(()=>applyNormalizedRepairs(doc,[],{...options,sectionSourceId:'missing'}),/does not exist/);
 assert.throws(()=>applyNormalizedRepairs(doc,Array.from({length:31},()=>({op:'set',id:'title',unset:['size']})),options),/Invalid normalized repair/);
 const outside=structuredClone(doc);outside.children[0].children[0].figmaNodeId='20:2';assert.throws(()=>applyNormalizedRepairs(outside,[],options),/out-of-section/);
 const duplicate=structuredClone(doc);duplicate.children[0].children[1].id='title';assert.throws(()=>applyNormalizedRepairs(duplicate,[],options),/unique/);
 const cyclic=structuredClone(doc);cyclic.children[0].children.push(cyclic.children[0]);assert.throws(()=>applyNormalizedRepairs(cyclic,[],options),/cycle/);
});
test('schema and model instructions expose only the supported finite operations',()=>{
 assert.deepEqual(NORMALIZED_REPAIR_SCHEMA.items.oneOf.map(s=>s.properties.op.const),['set','move','group','restore']);
 assert.match(NORMALIZED_REPAIR_PROMPT,/never Bricks IDs/);assert.match(NORMALIZED_REPAIR_PROMPT,/Maximum 30 operations/);
});
test('saved Tapijtschuur missing text is restored and survives the actual compiler round trip',()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const source=path.join(root,'output','recreate-attached-design-e3902415');
 const rawRoot=JSON.parse(fs.readFileSync(path.join(source,'figma-node.json'),'utf8'));
 const doc=JSON.parse(fs.readFileSync(path.join(source,'sections','section-05','normalized.json'),'utf8'));
 const original=structuredClone(doc),manifest=JSON.parse(fs.readFileSync(path.join(source,'asset-manifest.json'),'utf8')).map(a=>({...a,file:path.resolve(source,a.file)}));
 const all=n=>[n,...(n.children||[]).flatMap(all)];
 const wrapper=all(doc).find(n=>n.id==='craftsmanship-label-wrapper');
 assert.equal(wrapper.children[0].figmaNodeId,'11:4200');wrapper.children=[];
 const repaired=applyNormalizedRepairs(doc,[{op:'restore',id:'craftsmanship-label',sourceId:'11:4200',parentId:wrapper.id,index:0}],{rawRoot,sectionSourceId:'11:4196',manifest});
 assert.deepEqual(all(repaired).filter(n=>n.id).map(n=>n.id).sort(),all(original).filter(n=>n.id).map(n=>n.id).sort());
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'normalized-roundtrip-'));
 try{
  fs.writeFileSync(path.join(temp,'normalized.json'),JSON.stringify(repaired));
  fs.writeFileSync(path.join(temp,'figma-node.json'),JSON.stringify(rawRoot));
  fs.writeFileSync(path.join(temp,'asset-manifest.json'),JSON.stringify(manifest));
  const compilation=spawnSync(process.execPath,[path.join(root,'scripts','3_compile_bricks.js'),temp],{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(compilation.status,0,compilation.stderr||compilation.error?.message);
  const tree=JSON.parse(fs.readFileSync(path.join(temp,'bricks-tree.json'),'utf8'));
  const mappings=JSON.parse(fs.readFileSync(path.join(temp,'bricks-source-map.json'),'utf8'));
  const restored=tree.filter(e=>mappings[e.id]?.figmaNodeId==='11:4200');
  assert.equal(restored.length,1);assert.match(restored[0].settings.text,/Ons vakmanschap/);
  assert.deepEqual(validateBuild(tree,temp).errors,[]);
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('normalized-roundtrip-'))throw Error('Unexpected test cleanup path');
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
