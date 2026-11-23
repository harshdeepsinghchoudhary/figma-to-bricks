// Deterministic evidence for the repair agent. A measured discrepancy is not
// automatically proof of its cause: stage/confidence make that distinction explicit.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const plain=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const px=v=>finite(v)?v:typeof v==='string'&&/^-?\d+(?:\.\d+)?(?:px)?$/.test(v.trim())?parseFloat(v):undefined;
const round=v=>Math.round(v*100)/100;
const same=(a,b,tolerance=1)=>finite(a)&&finite(b)?Math.abs(a-b)<=tolerance:a===b;
const family=v=>String(v??'').split(',')[0].replace(/["']/g,'').trim().toLowerCase();
const imageNode=n=>['image','icon'].includes(n?.type)&&!!n.asset;
const background=n=>(n?.fills||[]).some(f=>f.visible!==false&&['SOLID','IMAGE','GRADIENT_LINEAR','GRADIENT_RADIAL'].includes(f.type));
function indexTree(root){
 const nodes=new Map(),parents=new Map(),visible=new Map();
 function visit(n,parent,hidden=false){
  if(!n||typeof n!=='object')return;
  if(n.id){if(nodes.has(n.id))throw Error(`Duplicate evidence node id: ${n.id}`);nodes.set(n.id,n);parents.set(n.id,parent);visible.set(n.id,!hidden&&n.visible!==false&&n.figma?.effectiveVisible!==false);}
  for(const c of n.children||[])visit(c,n.id||parent,hidden||n.visible===false||n.figma?.effectiveVisible===false);
 }visit(root,null);return {nodes,parents,visible};
}
function sides(value){
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,px(v)]));
 const values=String(value??'').trim().split(/\s+/).map(px);if(!values.length||values.some(v=>v===undefined)||values.length>4)return {};
 const [a,b=a,c=a,d=b]=values;return {top:a,right:b,bottom:c,left:d};
}
function color(value){
 if(value?.raw)value=value.raw;
 if(typeof value!=='string')return undefined;
 let m=/^#([a-f\d]{6})([a-f\d]{2})?$/i.exec(value);
 if(m)return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)).concat(m[2]?parseInt(m[2],16)/255:1);
 m=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
 return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:undefined;
}
function sourceColor(paint){const c=paint?.color;return c?[c.r*255,c.g*255,c.b*255,(c.a??1)*(paint.opacity??1)]:undefined;}
const colorEqual=(a,b)=>a&&b&&a.every((v,i)=>Math.abs(v-b[i])<=(i===3?.02:2));

export function analyzeRootCauses({rawRoot,normalized,tree=[],sourceMap={},metrics=[],sectionSourceId,sectionRootIds=[],manifest=[]}){
 const raw=indexTree(rawRoot),norm=indexTree(normalized),section=raw.nodes.get(sectionSourceId);
 if(!section)throw Error('Root-cause evidence requires a known Figma section');
 const scope=new Set();(function walk(n){scope.add(n.id);for(const c of n.children||[])walk(c);})(section);
 const sourceOf=n=>n?.figmaNodeId||n?.asset?.nodeId;
 const bySource=new Map(),byNormalized=new Map(),compiled=new Map(tree.map(e=>[e.id,e]));
 const sourceMapOf=e=>sourceMap[e.id]||{};
 for(const n of norm.nodes.values()){const id=sourceOf(n);if(id){const list=bySource.get(id)||[];list.push(n);bySource.set(id,list);}}
 for(const e of tree){const id=sourceMapOf(e).normalizedId;if(id){const list=byNormalized.get(id)||[];list.push(e);byNormalized.set(id,list);}}
 const compiledBySource=new Map();for(const e of tree){const id=sourceMapOf(e).figmaNodeId||sourceOf(norm.nodes.get(sourceMapOf(e).normalizedId));if(id){const list=compiledBySource.get(id)||[];list.push(e);compiledBySource.set(id,list);}}
 const manifestIds=new Set(manifest.map(a=>a.nodeId));
 const allNormalizedText=[...norm.nodes.values()].map(n=>plain(n.text)).filter(Boolean);
 const findings=[],mappings=[];const add=f=>findings.push({id:`finding-${findings.length+1}`,severity:'medium',confidence:'medium',...f});
 const sourceContext=(id,n,e)=>({sourceId:id,...(n?.id?{normalizedId:n.id}:{}),...(e?.id?{elementId:e.id}:{})});
 function coveredByAncestor(id){
  for(let p=raw.parents.get(id);p;p=raw.parents.get(p)){
   for(const n of bySource.get(p)||[]){
    if(imageNode(n))return {status:'exported-descendant',ownerId:n.id};
    if(n.type==='button'&&raw.nodes.get(id)?.type==='TEXT'&&plain(n.text)===plain(raw.nodes.get(id).characters))return {status:'button-label',ownerId:n.id};
   }
  }
  for(const n of norm.nodes.values())if(n.figma?.paintSourceIds?.includes(id))return {status:'absorbed-paint',ownerId:n.id};
  return null;
 }
 const sourceAncestor=(id,parentIndex,nodeIndex,getSource,required)=>{
  const visited=new Set();for(let p=parentIndex.get(id);p&&!visited.has(p);p=parentIndex.get(p)){visited.add(p);const sid=getSource(nodeIndex.get(p));if(sid&&(!required||required.has(sid)))return sid;}return null;
 };
 const normalizedSources=new Set(bySource.keys());
 for(const id of scope){
  const s=raw.nodes.get(id),ns=bySource.get(id)||[],es=compiledBySource.get(id)||[];
  if(!raw.visible.get(id)){mappings.push({sourceId:id,status:'hidden-source'});continue;}
  const coverage=coveredByAncestor(id);
  if(!ns.length&&!es.length){
   if(coverage){mappings.push({sourceId:id,...coverage});continue;}
   // Flattened source wrappers need not have their own DOM element. Missing
   // text is stronger evidence than an absent non-rendering frame mapping.
   const text=plain(s.characters);
   const hasEquivalentText=text&&allNormalizedText.some(t=>t.includes(text));
   const status=hasEquivalentText?'text-covered-without-node-mapping':s.children?.length?'unmapped-wrapper':'unmapped-source';
   mappings.push({sourceId:id,status});
   if(s.type==='TEXT'&&text&&!hasEquivalentText)add({...sourceContext(id),category:'missing-content',stage:'normalization',confidence:'high',severity:'high',expected:{text},observed:{normalizedTextPresent:false},explanation:'Visible Figma text is absent from the normalized content and is not covered by a button or exported ancestor.'});
   else if(!s.children?.length&&(s.type==='TEXT'||background(s)))add({...sourceContext(id),category:'mapping',stage:'unknown',confidence:'low',expected:{type:s.type},observed:{status},explanation:'This visible source node has no direct mapping. It may have been absorbed into another paint or asset; inspect the screenshots before restoring it.'});
   continue;
  }
  const n=ns[0],e=es.find(e=>e.name!=='section')||es[0];
  mappings.push({...sourceContext(id,n,e),normalizedIds:ns.map(n=>n.id),elementIds:es.map(e=>e.id),status:es.length?'mapped':'normalized-only'});
  if(n&&!es.length&&['text','heading','button','image','icon'].includes(n.type))add({...sourceContext(id,n),category:'compiler-mapping',stage:'compiler',confidence:'medium',expected:{normalizedType:n.type},observed:{elementIds:[]},explanation:'A normalized renderable node has no compiled source mapping; compiler absorption or omission must be checked.'});
  if(!n)continue;
  const expectedParent=sourceAncestor(id,raw.parents,raw.nodes,x=>x?.id,normalizedSources);
  const actualParent=sourceAncestor(n.id,norm.parents,norm.nodes,sourceOf,normalizedSources);
  if(expectedParent&&actualParent&&expectedParent!==actualParent){
   const boundary=raw.nodes.get(expectedParent),important=boundary?.clipsContent||background(boundary)||['HORIZONTAL','VERTICAL','GRID'].includes(boundary?.layoutMode);
   add({...sourceContext(id,n,e),category:'hierarchy',stage:'normalization',confidence:important?'medium':'low',expected:{parentSourceId:expectedParent},observed:{parentSourceId:actualParent},explanation:important?'Normalized nesting bypasses a source paint, clipping or Auto Layout boundary; verify whether this caused the rendered mismatch.':'Source nesting differs after normalization; this may be intentional wrapper flattening and requires visual corroboration.'});
  }
  if(n.asset?.nodeId&&!manifestIds.has(n.asset.nodeId))add({...sourceContext(id,n,e),category:'assets',stage:'extraction',confidence:'high',severity:'high',expected:{assetNodeId:n.asset.nodeId},observed:{manifestEntry:false},explanation:'The normalized asset references an export absent from the manifest; styling changes cannot repair it.'});
 }
 const viewportWidth=rawRoot.absoluteBoundingBox?.width;
 const metricsList=Array.isArray(metrics)?metrics:Object.values(metrics||{});
 for(const snapshot of metricsList){
  const observed=new Map((snapshot.elements||[]).map(e=>[e.id,e]));
  const desktop=finite(viewportWidth)&&Math.abs(snapshot.width-viewportWidth)<=1;
  const roots=[...sectionRootIds,...(compiledBySource.get(sectionSourceId)||[]).map(e=>e.id)].map(id=>observed.get(id)).filter(e=>e&&e.width>0&&e.height>0);
  const origin=roots.length?{x:Math.min(...roots.map(e=>e.x)),y:Math.min(...roots.map(e=>e.y))}:null;
  for(const mapping of mappings.filter(m=>m.status==='mapped')){
   const s=raw.nodes.get(mapping.sourceId),n=norm.nodes.get(mapping.normalizedId);
   // A source can generate a wrapper plus leaf. Compare the element directly
   // associated with its normalized node rather than every generated wrapper.
   const es=mapping.elementIds.map(id=>compiled.get(id));
   const e=es.find(e=>sourceMapOf(e).normalizedId===n?.id)||es[0],a=observed.get(e.id);
   const context={...sourceContext(s.id,n,e),viewport:snapshot.width,referenceAvailable:desktop};
   if(!a){add({...context,category:'missing-element',stage:'rendering',confidence:'medium',expected:{compiled:true},observed:{domPresent:false},explanation:'Compiled element was not observed in the rendered DOM. Native controls may transform markup; confirm the screenshot and DOM before restoring content.'});continue;}
   if(a.display==='none'||a.width<=0||a.height<=0){
    if(desktop&&n?.figma?.effectiveVisible!==false&&e.settings?._display!=='none')add({...context,category:'visibility',stage:'browser-cascade',confidence:'medium',expected:{visible:true},observed:{display:a.display,width:a.width,height:a.height},explanation:'A visible source has no rendered box at the reference viewport. Inspect responsive rules or native component state.'});
    continue;
   }
   if(a.brokenImage)add({...context,category:'assets',stage:'asset-delivery',confidence:'high',severity:'high',expected:{loaded:true},observed:{brokenImage:true},explanation:'The browser could not decode or load the image; repair asset delivery before adjusting geometry.'});
   if(a.clippedText)add({...context,category:'dimensions',stage:'browser-layout',confidence:'high',severity:'high',expected:{unclippedText:true},observed:{clippedText:true},explanation:'The rendered text exceeds a clipping box; inspect fixed height/width and overflow settings.'});
   if(!desktop)continue; // No fabricated tablet/mobile Figma reference.
   const b=s.absoluteBoundingBox;
   if(b){
    const expected={width:b.width,height:b.height,...(origin&&section.absoluteBoundingBox?{x:b.x-section.absoluteBoundingBox.x,y:b.y-section.absoluteBoundingBox.y}:{})};
    const actual={width:a.width,height:a.height,...(origin?{x:a.x-origin.x,y:a.y-origin.y}:{})};
    for(const field of Object.keys(expected))if(finite(actual[field])&&Math.abs(actual[field]-expected[field])>2){
     const normalizedValue=px(n?.size?.[field]),compiledValue=px(e.settings?.[`_${field}`]);
     const dimension=['width','height'].includes(field);
     const stage=dimension&&normalizedValue!==undefined&&!same(normalizedValue,expected[field],2)?'normalization':dimension&&compiledValue!==undefined&&!same(compiledValue,expected[field],2)?'compiler':'browser-layout';
     add({...context,category:['x','y'].includes(field)?'positioning':'dimensions',stage,confidence:stage==='browser-layout'?'medium':'high',expected:{[field]:round(expected[field])},observed:{[field]:round(actual[field]),...(normalizedValue!==undefined?{normalized:normalizedValue}:{}),...(compiledValue!==undefined?{compiled:compiledValue}:{})},explanation:stage==='normalization'?'The normalized dimension differs from the measured Figma box and the browser also differs.':stage==='compiler'?'The compiled fixed dimension differs from the Figma measurement while the earlier normalized value does not record this change.':'The rendered box differs at matching viewport scale; compare ancestor layout, intrinsic text size and compiled settings before attributing a cause.'});
    }
   }
   if(s.type==='TEXT'){
    const style=s.style||{},t=n?.typography||{},compiledTypography=e.settings?._typography||{};
    const props=[['fontSize','font-size',style.fontSize,px(a.fontSize)],['fontWeight','font-weight',style.fontWeight,px(a.fontWeight)],['lineHeight','line-height',style.lineHeightPx,px(a.lineHeight)],['letterSpacing','letter-spacing',style.letterSpacing,px(a.letterSpacing)]];
    for(const [key,css,expected,actual] of props)if(finite(expected)&&finite(actual)&&!same(expected,actual,key==='fontWeight'?0:1)){
     const nv=px(t[key]),cv=px(compiledTypography[css]),stage=nv!==undefined&&!same(nv,expected)?'normalization':cv!==undefined&&!same(cv,expected)?'compiler':'browser-cascade';
     add({...context,category:'typography',stage,confidence:stage==='browser-cascade'?'medium':'high',expected:{[key]:expected},observed:{[key]:actual,...(nv!==undefined?{normalized:nv}:{}),...(cv!==undefined?{compiled:cv}:{})},explanation:`${key} differs between Figma and the browser; the first differing recorded stage is ${stage}.`});
    }
    if(style.fontFamily&&a.fontFamily&&family(style.fontFamily)!==family(a.fontFamily))add({...context,category:'typography',stage:t.fontFamily&&family(t.fontFamily)!==family(style.fontFamily)?'normalization':'browser-cascade',confidence:'medium',expected:{fontFamily:style.fontFamily},observed:{fontFamily:a.fontFamily},explanation:'The requested browser font family differs from Figma. Platform font evidence is needed to distinguish delivery fallback from a cascade issue.'});
    const expectedColor=sourceColor(s.fills?.find(f=>f.visible!==false&&f.type==='SOLID')),actualColor=color(a.color);
    if(expectedColor&&actualColor&&!colorEqual(expectedColor,actualColor))add({...context,category:'color',stage:'browser-cascade',confidence:'medium',expected:{rgba:expectedColor.map(round)},observed:{rgba:actualColor.map(round)},explanation:'Text color differs from the source solid paint; check normalized typography, inheritance and opacity.'});
   }
   if(['HORIZONTAL','VERTICAL','GRID'].includes(s.layoutMode)){
    const padding=sides(a.padding);
    for(const side of ['top','right','bottom','left']){const key=`padding${side[0].toUpperCase()}${side.slice(1)}`,expected=s[key],actual=padding[side];if(finite(expected)&&finite(actual)&&!same(expected,actual))add({...context,category:'spacing',stage:px(n?.layout?.padding?.[side])!==undefined&&!same(px(n.layout.padding[side]),expected)?'normalization':'browser-layout',confidence:'medium',expected:{[key]:expected},observed:{[key]:actual},explanation:'Rendered padding differs from explicit Figma Auto Layout padding.'});}
    const gap=px(s.layoutMode==='HORIZONTAL'?a.columnGap??a.gap:a.rowGap??a.gap);
    if(finite(s.itemSpacing)&&s.itemSpacing>=0&&finite(gap)&&!same(s.itemSpacing,gap))add({...context,category:'spacing',stage:'browser-layout',confidence:'medium',expected:{gap:s.itemSpacing},observed:{gap},explanation:'Rendered gap differs from explicit Figma Auto Layout spacing.'});
    const expectedDirection={HORIZONTAL:'row',VERTICAL:'column'}[s.layoutMode];
    if(expectedDirection&&a.flexDirection&&a.display==='flex'&&a.flexDirection!==expectedDirection)add({...context,category:'hierarchy',stage:n?.layout?.direction&&n.layout.direction!==expectedDirection?'normalization':'browser-layout',confidence:'medium',expected:{direction:expectedDirection},observed:{direction:a.flexDirection},explanation:'The rendered flow direction differs from explicit Figma Auto Layout. Check whether a responsive or synthetic wrapper changed the child layout.'});
    const align={MIN:'flex-start',CENTER:'center',MAX:'flex-end',SPACE_BETWEEN:'space-between',BASELINE:'baseline'};
    for(const [sourceKey,actualKey] of [['primaryAxisAlignItems','justifyContent'],['counterAxisAlignItems','alignItems']]){
     const expected=align[s[sourceKey]],actual=a[actualKey];
     if(expected&&actual&&a.display==='flex'&&expected!==actual&&!(expected==='flex-start'&&['start','normal'].includes(actual))&&!(expected==='flex-end'&&actual==='end'))add({...context,category:'spacing',stage:'browser-layout',confidence:'medium',expected:{[actualKey]:expected},observed:{[actualKey]:actual},explanation:'The rendered flex alignment differs from explicit Figma Auto Layout alignment.'});
    }
   }
   const paints=(s.fills||[]).filter(p=>p.visible!==false);
   if(s.type!=='TEXT'&&paints.length===1&&paints[0].type==='SOLID'){
    const expectedColor=sourceColor(paints[0]),actualColor=color(a.backgroundColor);
    if(expectedColor&&actualColor&&!colorEqual(expectedColor,actualColor))add({...context,category:'color',stage:'browser-cascade',confidence:'medium',expected:{backgroundRgba:expectedColor.map(round)},observed:{backgroundRgba:actualColor.map(round)},explanation:'The rendered background color differs from the source solid paint; check whether the compiler moved the paint to a wrapper or pseudo-element.'});
   }
   if(finite(s.cornerRadius)&&px(a.borderRadius)!==undefined&&!same(s.cornerRadius,px(a.borderRadius)))add({...context,category:'dimensions',stage:'browser-cascade',confidence:'medium',expected:{borderRadius:s.cornerRadius},observed:{borderRadius:px(a.borderRadius)},explanation:'The rendered corner radius differs from the uniform Figma corner radius.'});
  }
 }
 const counts={sources:scope.size,mapped:mappings.filter(m=>m.status==='mapped').length,findings:findings.length,byCategory:{}};
 for(const f of findings)counts.byCategory[f.category]=(counts.byCategory[f.category]||0)+1;
 return {version:1,sectionSourceId,referenceViewport:viewportWidth,counts,mappings,findings,note:'Root causes are evidence-ranked diagnoses. Only matching-width geometry uses the desktop Figma reference; lower viewport checks do not imply responsive design parity.'};
}

export function compactRootCauseContext(report,{maxFindings=120,maxMappings=200}={}){
 const findings=report.findings.slice().sort((a,b)=>({high:0,medium:1,low:2}[a.severity]-({high:0,medium:1,low:2}[b.severity]))).slice(0,maxFindings);
 return {sectionSourceId:report.sectionSourceId,referenceViewport:report.referenceViewport,counts:report.counts,findings,mappings:report.mappings.slice(0,maxMappings),truncated:report.findings.length>findings.length||report.mappings.length>maxMappings,note:report.note};
}
