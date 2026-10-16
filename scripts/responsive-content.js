import { BRICKS_BREAKPOINTS } from './breakpoints.js';
export function responsiveContent(tree,sourceMap={},root){
 const nodes=new Map(tree.map(e=>[e.id,e]));
 const raw=new Map();(function walk(n){if(!n)return;raw.set(n.id,n);for(const c of n.children||[])walk(c);})(root);
 const tablet=BRICKS_BREAKPOINTS.tablet,mobile=BRICKS_BREAKPOINTS.mobile;
 const mobileWidth=BRICKS_BREAKPOINTS.variants.find(b=>b.key===mobile)?.width||767;
 const ancestry=e=>{const a=[];for(let n=e;n;n=nodes.get(n.parent))a.push(n);return a;};
 const footer=e=>ancestry(e).some(n=>/footer/i.test(sourceMap[n.id]?.normalizedId||''));
 for(const e of tree){
  const s=e.settings||{};
  const header=ancestry(e).some(n=>/header-navigation/i.test(sourceMap[n.id]?.normalizedId||''));
  const inset=sourceMap[e.id]?.headerPageInset;
  if(inset>0&&s._padding){for(const side of ['left','right'])if(parseFloat(s._padding[side])>=inset)s._padding[side]=String(parseFloat(s._padding[side])-inset);}
  if(['nav-nested','nav-menu'].includes(e.name)&&header){
   s.mobileMenu='custom';s.mobileMenuCustomBreakpoint='1024';s._widthMax='100%';
  }
  // Measured one-line desktop labels still need to wrap when their row shrinks.
  // Native navigation owns its label sizing and is excluded here.
  if(['text','text-basic','heading'].includes(e.name)&&!header&&s._position!=='absolute'){
   s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{min-width:0;max-width:100%;flex-shrink:1;overflow-wrap:anywhere}}`;
  }
  // Small logos/icons and pinned artwork are not content images that should grow.
  if(e.name==='image' && parseFloat(s._widthMax)>160 && !ancestry(e).some(n=>n.settings?._position==='absolute')){
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
     const cs=child.settings,left=parseFloat(cs._left),width=parseFloat(cs._width);
     if(Number.isFinite(left))cs._cssCustom=`${cs._cssCustom||''}\n@media(max-width:1024px){#brxe-${child.id}{left:${left/box.width*100}%;${Number.isFinite(width)?`width:${width/box.width*100}%;`:''}max-width:${Math.max(0,100-left/box.width*100)}%}}`;
    }
   }
  }
  if(!footer(e)||s._direction!=='row'||kids.length<2||!kids.every(k=>['div','block','container'].includes(k.name)))continue;
  s[`_direction:${tablet}`]='row';s[`_flexWrap:${tablet}`]='wrap';s[`_alignItems:${tablet}`]='flex-start';
  s._cssCustom=`${s._cssCustom||''}\n@media(max-width:1024px){#brxe-${e.id}{flex-direction:row;flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;gap:24px}#brxe-${e.id}>*{flex:1 1 calc(50% - 12px);min-width:0;max-width:100%}} @media(max-width:${mobileWidth}px){#brxe-${e.id}>*{flex-basis:100%;width:100%}}`;
 }
}
