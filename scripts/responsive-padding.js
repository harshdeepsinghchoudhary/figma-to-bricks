import { BRICKS_BREAKPOINTS } from './breakpoints.js';
const px=value=>/^(?:\d+(?:\.\d+)?)(?:px)?$/.test(String(value))?parseFloat(value):null;
// Final pass also covers native components and controls created after normalization.
export function capTabletPadding(tree){
  for(const el of tree){
    const s=el.settings||{},base=s._padding||{};
    const sides=['left','right'].filter(side=>px(base[side])>20 || BRICKS_BREAKPOINTS.variants.some(b=>b.width<=1024&&px(s[`_padding:${b.key}`]?.[side])>20));
    if(!sides.length)continue;
    const rules=[],effective={...base};
    const points=[1024,...BRICKS_BREAKPOINTS.variants.filter(b=>b.width<=1024).map(b=>b.width)].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>b-a);
    for(const width of points){
      for(const b of BRICKS_BREAKPOINTS.variants.filter(b=>b.width===width)){
        const override=s[`_padding:${b.key}`];
        if(override){Object.assign(effective,override);for(const side of sides)if(px(override[side])>20)override[side]='20';}
      }
      const declarations=sides.filter(side=>px(effective[side])!==null).map(side=>`padding-${side}:${Math.min(20,px(effective[side]))}px`).join(';');
      if(declarations)rules.push(`@media(max-width:${width}px){#brxe-${el.id}{${declarations}}}`);
    }
    s._cssCustom=[s._cssCustom||'',...rules].join('\n');
  }
}
