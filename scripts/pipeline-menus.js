import {createHash} from 'node:crypto';
import {discoverFooterMenus} from './footer-menus.js';

const plain = value => String(value || '').replace(/<[^>]*>/g, '').trim();
export function discoverMenus(tree, sourceMap, controls = []) {
  const byId = new Map(tree.map(e => [e.id,e]));
  const descendants = e => [e,...(e.children || []).flatMap(id => descendants(byId.get(id)))];
  const source = e => sourceMap[e.id]?.figmaNodeId;
  const plans = discoverFooterMenus(tree,sourceMap).map(b => ({...b,role:'footer',key:b.list}));
  for (const control of controls) {
    const nav = tree.find(e => source(e) === control.navigation);
    if (!nav) continue;
    const items = descendants(nav).filter(e => ['text','text-basic','text-link'].includes(e.name)).map(e => plain(e.settings?.text)).filter(Boolean);
    if (items.length) plans.push({role:'header',key:control.navigation,title:'Header',items:['Home',...items.filter(s => s !== 'Home')],control});
  }
  // Normalized header ancestry plus a row of short labels is menu evidence.
  for (const e of tree) {
    if (!source(e) || plans.some(p => p.key === source(e))) continue;
    let alreadyOwned=false;
    for(let parent=byId.get(e.parent);parent;parent=byId.get(parent.parent))if(plans.some(p=>p.role==='header'&&p.key===source(parent)))alreadyOwned=true;
    if(alreadyOwned)continue;
    let header = false;
    for(let n=e;n;n=byId.get(n.parent)) if(/header|nav(?:igation)?/i.test(sourceMap[n.id]?.normalizedId || '')) header=true;
    if (!header) continue;
    const labels=(e.name==='nav-nested'?descendants(e):(e.children || []).map(id=>byId.get(id))).filter(n=>['text','text-basic','text-link'].includes(n.name));
    if(labels.length<3 || labels.some(n=>!plain(n.settings?.text)||plain(n.settings?.text).length>30))continue;
    plans.push({role:'header',key:source(e),title:'Header',items:labels.map(n=>plain(n.settings.text)),...(e.name!=='nav-nested'?{members:labels.map(source)}:{})});
  }
  return plans;
}

export async function provisionMenus(plans, {api,site,frame,previous=[]}) {
  const result=[];
  for(const plan of plans){
    const old=previous.find(p=>p.key===plan.key && p.role===plan.role && p.site===site);
    const slug=old?.slug || `figma-${createHash('sha256').update(frame+':'+plan.role+':'+plan.key).digest('hex').slice(0,20)}`;
    const name=`${frame} - ${plan.title}`;
    const byName=async()=>{
      for(let page=1;;page++){
        const matches=await api(`menus?search=${encodeURIComponent(name)}&per_page=100&page=${page}&context=edit`);
        const exact=matches.find(m=>m.name===name);
        if(exact)return exact;
        if(matches.length<100)return null;
      }
    };
    let menu=(await api(`menus?slug=${encodeURIComponent(slug)}&context=edit`))[0];
    if(!menu)menu=await byName();
    if(!menu){
      try{menu=await api('menus',{name,slug});}
      catch(error){
        if(error.code!=='menu_exists')throw error;
        // Another run may have created the menu after our lookup. WordPress
        // can derive its own slug from the name rather than use our request.
        menu=await byName();
        if(!menu)throw error;
      }
    }
    const existing=await api(`menu-items?menus=${menu.id}&per_page=100&context=edit`);
    for(const [i,title] of plan.items.entries()){
      if(existing.some(item=>plain(item.title?.raw || item.title?.rendered)===title))continue;
      const item=await api('menu-items',{title,type:'custom',url:title.toLowerCase()==='home'?site+'/':'#',menus:menu.id,menu_order:i+1,status:'publish'});
      existing.push(item);
    }
    result.push({...plan,menuId:menu.id,slug:menu.slug || slug,site});
  }
  return result;
}

export function applyHeaderMenus(tree,sourceMap,bindings){
  for(const b of bindings.filter(b=>b.role==='header'&&!b.control)){
    let nav=tree.find(e=>sourceMap[e.id]?.figmaNodeId===b.key);
    if(!nav)throw new Error(`Header menu source missing: ${b.key}`);
    if(b.members){
      const host=nav,selected=host.children.filter(id=>b.members.includes(sourceMap[id]?.figmaNodeId));
      if(selected.length!==b.members.length)throw new Error('Header menu labels changed; rebuild menu plan');
      const id=createHash('sha256').update(host.id+'-wordpress-menu').digest('hex').slice(0,6);
      nav={id,name:'nav-menu',parent:host.id,children:selected,settings:{}};
      const first=host.children.indexOf(selected[0]);
      host.children=host.children.filter(id=>!selected.includes(id));host.children.splice(first,0,id);
      tree.push(nav);sourceMap[id]={normalizedId:'header-navigation-widget'};
      host.settings._direction='row';host.settings._flexWrap='nowrap';
      for(const key of Object.keys(host.settings))if(/^_direction:/.test(key))host.settings[key]='row';
    }
    const removed=new Set();
    function visit(e){for(const id of e.children || []){removed.add(id);visit(tree.find(n=>n.id===id));}}
    visit(nav);
    for(let i=tree.length-1;i>=0;i--)if(removed.has(tree[i].id)){delete sourceMap[tree[i].id];tree.splice(i,1);}
    nav.name='nav-menu';nav.children=[];
    nav.settings={menu:String(b.menuId),mobileMenu:'custom',mobileMenuCustomBreakpoint:'1024',_width:'100%',menuAlignment:'row'};
  }
}
