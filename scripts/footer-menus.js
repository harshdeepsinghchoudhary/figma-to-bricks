export function discoverFooterMenus(tree,sourceMap){
 const byId=new Map(tree.map(e=>[e.id,e]));
 const inFooter=e=>{for(let n=e;n;n=byId.get(n.parent))if(/footer/i.test(sourceMap[n.id]?.normalizedId||''))return true;return false;};
 const plain=s=>String(s||'').replace(/<[^>]+>/g,'').trim();
 return tree.filter(inFooter).flatMap(e=>{
  const kids=(e.children||[]).map(id=>byId.get(id));if(kids.length!==2)return [];
  const [heading,list]=kids,title=plain(heading.settings?.text);
  if(!['heading','text','text-basic'].includes(heading.name)||!['text','text-basic'].includes(list.name)||!title||title.length>60)return [];
  const items=String(list.settings.text||'').split(/<br\s*\/?\s*>|\n/i).map(plain).filter(Boolean);
  if(items.length<2)return [];
  return [{heading:sourceMap[heading.id]?.figmaNodeId,list:sourceMap[list.id]?.figmaNodeId,title,items}];
 });
}
export function applyFooterMenus(tree,sourceMap,bindings){
 for(const b of bindings){
  const heading=tree.find(e=>sourceMap[e.id]?.figmaNodeId===b.heading),list=tree.find(e=>sourceMap[e.id]?.figmaNodeId===b.list);
  if(!heading||!list)throw new Error(`Footer menu source missing: ${b.title}`);
  heading.name='heading';heading.settings.text=b.title;heading.settings.tag='h3';
  const typography=list.settings._typography;
  list.name='nav-menu';list.children=[];
  list.settings={menu:String(b.menuId),mobileMenu:'never',menuAlignment:'column',menuGap:'0',menuTypography:typography,_width:'100%',_cssCustom:`#brxe-${list.id} .bricks-nav-menu{align-items:flex-start} #brxe-${list.id} .bricks-nav-menu>li{margin:0;max-width:100%} #brxe-${list.id} a{white-space:normal;overflow-wrap:anywhere}`};
 }
}
