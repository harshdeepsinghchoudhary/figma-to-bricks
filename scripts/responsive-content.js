import { BRICKS_BREAKPOINTS } from './breakpoints.js';
export function responsiveContent(tree,sourceMap={},root){
 const nodes=new Map(tree.map(e=>[e.id,e]));
 const raw=new Map();(function walk(n){if(!n)return;raw.set(n.id,n);for(const c of n.children||[])walk(c);})(root);
 const tablet=BRICKS_BREAKPOINTS.tablet,mobile=BRICKS_BREAKPOINTS.mobile;
 const mobileWidth=BRICKS_BREAKPOINTS.variants.find(b=>b.key===mobile)?.width||767;
 const ancestry=e=>{const a=[];for(let n=e;n;n=nodes.get(n.parent))a.push(n);return a;};
 const footer=e=>ancestry(e).some(n=>/footer/i.test(sourceMap[n.id]?.normalizedId||''));
 // A synthetic logo/menu/actions row inside a source header container should
 // not force all three groups into a vertical tablet stack.
 for(const row of tree){
  const kids=(row.children||[]).map(id=>nodes.get(id));
  if(kids.length!==3||!['nav-menu','nav-nested'].includes(kids[1]?.name))continue;
  const parent=nodes.get(row.parent);
  const inHeader=ancestry(row).some(n=>/header/i.test(raw.get(sourceMap[n.id]?.figmaNodeId)?.name||''));
  if(!inHeader||parent?.children?.length!==1)continue;
  const actions=kids[2];row.children=row.children.slice(0,2);parent.children=[row.id,actions.id];actions.parent=parent.id;
  Object.assign(parent.settings,{_direction:'row',_alignItems:'center',_justifyContent:'space-between'});
  parent.settings[`_flexWrap:${tablet}`]='wrap';parent.settings[`_rowGap:${tablet}`]='12';
  for(const group of [row,actions]){
   const s=group.settings;delete s._width;delete s._widthMax;delete s._margin;
   s[`_direction:${tablet}`]='row';s[`_rowGap:${tablet}`]='12';s[`_columnGap:${tablet}`]='12';
  }
  actions.settings[`_flexWrap:${tablet}`]='wrap';
  actions.settings._cssCustom=`${actions.settings._cssCustom||''}\n@media(max-width:1024px){#brxe-${actions.id}{max-width:100%;gap:12px}#brxe-${actions.id}>*{flex-shrink:0;width:auto;max-width:100%}#brxe-${actions.id} .brxe-text{white-space:nowrap;overflow-wrap:normal;min-width:max-content}}`;
  delete kids[1].settings._width;delete kids[1].settings._widthMax;
 }
 for(const e of tree){
  const s=e.settings||{};
  // Flex items default to min-width:auto. A slider's off-screen track must
  // not become the minimum width of the surrounding page.
  if(e.name==='slider-nested'){
   s._width=s._width||'100%';s._widthMax='100%';s._widthMin='0';
   for(const id of e.children||[]){const slide=nodes.get(id);if(slide){slide.settings||={};slide.settings._widthMax='100%';slide.settings._widthMin='0';}}
  }
  const source=raw.get(sourceMap[e.id]?.figmaNodeId);
  const logo=/logo/i.test(sourceMap[e.id]?.normalizedId||'');
  if(logo && source?.absoluteBoundingBox?.width){
   const width=source.absoluteBoundingBox.width;
   for(const bp of BRICKS_BREAKPOINTS.variants.filter(b=>b.width<=1024))s[`_widthMax:${bp.key}`]=`${width}px`;
   s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{max-width:min(100%,${width}px);flex-grow:0}}`;
  }
  const header=ancestry(e).some(n=>/header-navigation/i.test(sourceMap[n.id]?.normalizedId||''));
  const inset=sourceMap[e.id]?.headerPageInset;
  if(inset>0&&s._padding){for(const side of ['left','right'])if(parseFloat(s._padding[side])>=inset)s._padding[side]=String(parseFloat(s._padding[side])-inset);}
  if(['nav-nested','nav-menu'].includes(e.name)&&header){
   s.mobileMenu='custom';s.mobileMenuCustomBreakpoint='1024';
  }
  // Measured one-line desktop labels still need to wrap when their row shrinks.
  // Native navigation owns its label sizing and is excluded here.
  if(['text','text-basic','heading'].includes(e.name)&&!header&&s._position!=='absolute'){
   s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{min-width:0;max-width:100%;flex-shrink:1;overflow-wrap:anywhere}}`;
  }
  // Small logos/icons and pinned artwork are not content images that should grow.
  if(!logo && e.name==='image' && parseFloat(s._widthMax)>160 && !ancestry(e).some(n=>n.settings?._position==='absolute')){
   s[`_widthMax:${tablet}`]='100%';
   for(const point of BRICKS_BREAKPOINTS.variants.filter(b=>b.width<=1024))if(s[`_widthMax:${point.key}`])s[`_widthMax:${point.key}`]='100%';
   s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{max-width:100%;height:auto}}`;
  }
  const kids=(e.children||[]).map(id=>nodes.get(id));
  const box=raw.get(sourceMap[e.id]?.figmaNodeId)?.absoluteBoundingBox;
  const pinned=kids.filter(k=>k.settings?._position==='absolute');
  if(box?.width&&pinned.length){
   const textPinned=pinned.filter(k=>['text','text-basic','heading'].includes(k.name));
   if(textPinned.some(k=>String(k.settings.text||'').replace(/<[^>]*>/g,'').length>3)){
    s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{display:flex;flex-direction:column;gap:16px;height:auto;min-height:0} ${pinned.filter(k=>['text','text-basic','heading','image'].includes(k.name)).map(k=>`#brxe-${k.id}`).join(',')}{position:static;width:100%;max-width:100%;height:auto;margin:0;overflow-wrap:anywhere}}`;
   }else{
    for(const child of pinned){
     const cs=child.settings;
     // Percentage layers already scale with their parent; parseFloat('100%')
     // must never turn a full-width overlay into 100 desktop pixels.
     if(String(cs._left).includes('%')||String(cs._width).includes('%'))continue;
     const left=parseFloat(cs._left),width=parseFloat(cs._width);
     if(Number.isFinite(left))cs._cssCustom=`${cs._cssCustom||''}\n@media(max-width:1024px){#brxe-${child.id}{left:${left/box.width*100}%;${Number.isFinite(width)?`width:${width/box.width*100}%;`:''}max-width:${Math.max(0,100-left/box.width*100)}%}}`;
    }
   }
  }
  if(!footer(e)||s._direction!=='row'||kids.length<2||!kids.every(k=>['div','block','container'].includes(k.name)))continue;
  s[`_direction:${tablet}`]='row';s[`_flexWrap:${tablet}`]='wrap';s[`_alignItems:${tablet}`]='flex-start';
  s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{flex-direction:row;flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;gap:24px}#brxe-${e.id}>*{flex:1 1 calc(50% - 12px);min-width:0;max-width:100%}} @media(max-width:${mobileWidth}px){#brxe-${e.id}>*{flex-basis:100%;width:100%}}`;
 }
}
