import { createHash } from 'node:crypto';
const number=v=>typeof v==='number'?v:/^\d+(\.\d+)?(px)?$/.test(String(v))?parseFloat(v):0;
export function repairContentSpacing(tree,sourceMap={},root){
 const source=new Map();(function visit(n){if(!n)return;source.set(n.id,n);for(const c of n.children||[])visit(c);})(root?.document||root);
 const byId=new Map(tree.map(e=>[e.id,e])),report=[];
 // Some image cards already have a narrow, centered body wrapper. Let that
 // wrapper expand with the image on tablet/mobile instead of retaining its
 // desktop text measure. This also covers cards inside a decorative wrapper.
 for(const card of tree){
  const kids=(card.children||[]).map(id=>byId.get(id));
  if(kids.length!==2||kids[0]?.name!=='image')continue;
  const body=kids[1],content=(body.children||[]).map(id=>byId.get(id));
  if(!number(body.settings?._widthMax)||content.length<2||!content.some(e=>e.name==='button')||!content.some(e=>e.name==='heading')||!content.every(e=>['heading','text','text-basic','button'].includes(e.name)))continue;
  body.settings._width='100%';
  body.settings['_widthMax:tablet_portrait']='100%';
  body.settings['_padding:tablet_portrait']={...(body.settings._padding||{}),left:'20',right:'20'};
  const text=content.filter(e=>['heading','text','text-basic'].includes(e.name));
  if(body.settings._alignItems==='flex-start'&&text.some(e=>e.name!=='heading'&&e.settings._typography?.['text-align']==='left')){
   for(const heading of text.filter(e=>e.name==='heading')){
    heading.settings._typography={...heading.settings._typography,'text-align':'left'};
    heading.settings._alignSelf='flex-start';
   }
  }
  body.settings._cssCustom=`${body.settings._cssCustom||''}\n@media(max-width:1024px){#brxe-${body.id}{width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding-left:20px;padding-right:20px;align-items:flex-start} #brxe-${body.id}>*{min-width:0;max-width:100%;overflow-wrap:anywhere} ${text.map(e=>`#brxe-${e.id}`).join(',')}{width:100%;text-align:left;align-self:flex-start}}`;
  report.push(`${body.id}: existing card body expands with 20px inset below 1024px`);
 }
 for(const card of [...tree]){
  const kids=(card.children||[]).map(id=>byId.get(id));
  if(kids.length<3||kids[0]?.name!=='image'||!kids.slice(1).every(e=>['heading','text','text-basic','button'].includes(e?.name)))continue;
  const body=kids.slice(1),left=number(body[0].settings._margin?.left);
  if(left<=0||!body.every(e=>Math.abs(number(e.settings._margin?.left)-left)<1))continue;
  const id=createHash('sha256').update(card.id+'-card-body').digest('hex').slice(0,6);
  if(byId.has(id))throw new Error('Card body ID collision');
  const outer=byId.get(card.parent),bottom=number(card.settings._padding?.bottom)||((outer?.children?.length===1)?number(outer.settings._padding?.bottom):0);
  const wrapper={id,name:'div',parent:card.id,children:body.map(e=>e.id),settings:{_display:'flex',_direction:'column',_alignItems:'flex-start',_width:'100%',_widthMin:'0',_padding:{top:String(number(body[0].settings._margin?.top)),right:String(left),bottom:String(bottom),left:String(left)},_cssCustom:`#brxe-${id}{box-sizing:border-box} #brxe-${id}>*{min-width:0;max-width:100%;overflow-wrap:anywhere}`}};
  if(bottom){if(number(card.settings._padding?.bottom))card.settings._padding.bottom='0';else outer.settings._padding.bottom='0';}
  body.forEach((e,i)=>{e.parent=id;delete e.settings._margin.left;delete e.settings._margin.right;if(i===0)delete e.settings._margin.top;});
  card.children=[kids[0].id,id];tree.push(wrapper);byId.set(id,wrapper);
  report.push(`${card.id}: shared ${left}px child margins -> padded card body`);
 }
 for(const e of tree){
  const s=e.settings||{},kids=(e.children||[]).map(id=>byId.get(id));
  if(s._direction!=='row'||number(s._columnGap)<=60||kids.length<2||kids.some(c=>c.settings?._position==='absolute')||['slider-nested','nav-menu','nav-nested'].includes(e.name))continue;
  const box=source.get(sourceMap[e.id]?.figmaNodeId)?.absoluteBoundingBox;
  const boxes=kids.map(c=>source.get(sourceMap[c.id]?.figmaNodeId)?.absoluteBoundingBox);
  if(!box||boxes.some(b=>!b))continue;
  const gaps=boxes.slice(1).map((b,i)=>b.x-boxes[i].x-boxes[i].width);
  if(gaps.some(g=>g<0)||Math.max(...gaps)-Math.min(...gaps)>2)continue;
  s._width='100%';s._widthMax=`${box.width}px`;s._justifyContent='space-between';s._columnGap='20';s._rowGap='20';
  report.push(`${e.id}: fixed large gap -> measured ${box.width}px max-width and space-between`);
 }
 return report;
}
