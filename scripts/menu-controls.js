import { runtimeElement } from './native-components.js';
import { createHash } from 'node:crypto';

// Explicit cross-section bindings: appearance alone cannot determine which
// navigation a hamburger controls. Keep the binding in the frame's source data.
export function bindMenuControls(tree, sourceMap, bindings) {
  if (!bindings.length) return;
  if (!runtimeElement('toggle') || !runtimeElement('offcanvas') || !runtimeElement('nav-nested')) throw new Error('Menu toggle/offcanvas/navigation schema is unavailable');
  for (const binding of bindings) {
    const button = tree.find(e => sourceMap[e.id]?.figmaNodeId === binding.trigger);
    let target = tree.find(e => sourceMap[e.id]?.figmaNodeId === binding.content);
    if (!button || !target) throw new Error('Menu control source nodes are missing');
    const descendants = e => [e,...(e.children || []).flatMap(id=>descendants(tree.find(n=>n.id===id)))];
    const labels = descendants(target).filter(e=>['text','text-basic','text-link'].includes(e.name));
    const id = suffix => createHash('sha256').update(button.id+suffix).digest('hex').slice(0,6);
    const panel=id('panel'),inner=id('inner'),close=id('close'),backdrop=id('backdrop');
    const links=labels.map((e,i)=>({id:id(`link${i}`),name:'text-link',parent:inner,children:[],settings:{text:String(e.settings.text || '').replace(/<[^>]*>/g,''),...(e.settings.link?{link:e.settings.link}:{}),_typography:{'font-family':'Inter','font-size':'16px',color:{raw:'#FFFFFF'}}}}));
    tree.push({id:panel,name:'offcanvas',parent:0,children:[inner,backdrop],settings:{ariaLabel:'Navigation',direction:'left',width:'320px',noScrollBody:true}},
      {id:inner,name:'block',parent:panel,children:[close,...links.map(e=>e.id)],settings:{_hidden:{_cssClasses:'brx-offcanvas-inner'},_background:{color:{raw:'#2E0D16'}},_padding:{top:'24',right:'24',bottom:'24',left:'24'},_rowGap:'24'}},
      {id:close,name:'toggle',parent:inner,children:[],settings:{ariaLabel:'Close navigation',toggleSelector:`#brxe-${panel}`,barColor:{raw:'#FFFFFF'},animation:'boring'}},
      {id:backdrop,name:'block',parent:panel,children:[],settings:{_hidden:{_cssClasses:'brx-offcanvas-backdrop'}}},...links);
    const removed = new Set();
    function removeChildren(e) { for (const id of e.children || []) { removed.add(id); removeChildren(tree.find(n => n.id === id)); } }
    removeChildren(button);
    for (let i=tree.length-1;i>=0;i--) if (removed.has(tree[i].id)) { delete sourceMap[tree[i].id]; tree.splice(i,1); }
    button.name = 'toggle'; button.children = [];
    button.settings = { ariaLabel: 'Open navigation', toggleSelector: `#brxe-${panel}`, toggleValue: 'brx-open',
      barHeight: '2px', barRadius: '0px', barColor: {raw:'#FFFFFF'},
      _width:'22px', _height:'16px', _padding:{top:'0',right:'0',bottom:'0',left:'0'},
      _attributes:[{name:'aria-controls',value:`brxe-${panel}`}],
      _cssCustom:`#brxe-${button.id} .brxa-wrap { width:22px; height:16px; } #brxe-${button.id} .brxa-inner { width:22px; } #brxe-${button.id} .brxa-inner::before { top:-7px; width:22px; } #brxe-${button.id} .brxa-inner::after { bottom:-7px; width:22px; }`,
    };
    const bp=binding.breakpoint || 1024;
    const nav=tree.find(e=>sourceMap[e.id]?.figmaNodeId===binding.navigation);
    if (nav) {
      const menu=id('items'),open=id('open'),navClose=id('navclose');
      const separators=nav.children.filter(child=>!labels.some(e=>e.id===child));
      for(let i=tree.length-1;i>=0;i--) if(separators.includes(tree[i].id)){delete sourceMap[tree[i].id];tree.splice(i,1);}
      for(const e of labels){e.parent=menu;e.name='text-link';e.settings.text=String(e.settings.text).replace(/<[^>]*>/g,'');}
      nav.name='nav-nested';nav.children=[menu,open];
      nav.settings={mobileMenu:'custom',mobileMenuCustomBreakpoint:String(bp),ariaLabel:'Header navigation',gap:'44',_width:'auto',_cssCustom:`@media(min-width:${bp+1}px){#brxe-${menu}>li:not(:last-of-type)::after{content:'';position:absolute;right:-22px;top:50%;height:14px;width:1px;background:white;transform:translateY(-50%)} #brxe-${menu}>li{position:relative}}`};
      tree.push({id:menu,name:'block',parent:nav.id,children:[...labels.map(e=>e.id),navClose],settings:{tag:'ul',_hidden:{_cssClasses:'brx-nav-nested-items'},_direction:'row',_alignItems:'center'}},
        {id:open,name:'toggle',parent:nav.id,children:[],settings:{ariaLabel:'Open navigation'}},
        {id:navClose,name:'toggle',parent:menu,children:[],settings:{ariaLabel:'Close navigation',_hidden:{_cssClasses:'brx-toggle-div'}}});
    }
    const header=tree.find(e=>sourceMap[e.id]?.figmaNodeId===binding.header);
    const logo=tree.find(e=>sourceMap[e.id]?.figmaNodeId===binding.logo);
    if(header && logo){
      const nodes=descendants(header);
      for(const e of nodes){
        for(const key of Object.keys(e.settings)) if(/:/.test(key)&&/^_(direction|rowGap|columnGap|alignItems|widthMax):/.test(key)) delete e.settings[key];
        if(e.settings._direction==='row'){e.settings._flexWrap='nowrap';if(e!==header){e.settings._width='auto';e.settings._flexShrink='0';}}
      }
      logo.settings._width=logo.settings._widthMax || '86px';logo.settings._flexShrink='0';
      header.settings._columnGap='12';header.settings._widthMin='0';
      let band=target;while(band.parent)band=tree.find(e=>e.id===band.parent);
      band.settings._cssCustom=`${band.settings._cssCustom||''}\n@media(max-width:${bp}px){#brxe-${band.id}{display:none}}`;
      const actions=nodes.find(e=>e.children?.some(child=>tree.find(n=>n.id===child)?.name==='button'));
      header.settings._cssCustom=`${header.settings._cssCustom||''}\n#brxe-${header.id}{flex-wrap:nowrap} @media(max-width:478px){#brxe-${logo.id}{width:60px;max-width:60px} #brxe-${header.id}{column-gap:8px} ${actions?`#brxe-${actions.id}{column-gap:8px}`:''} #brxe-${header.id} .bricks-button{font-size:11px;line-height:16px;padding:10px;white-space:nowrap} #brxe-${header.id} .brxe-text{font-size:12px}}`;
      tree.find(e=>e.id===panel).settings._cssCustom=`#brxe-${panel} .brx-offcanvas-inner{max-width:100vw;overflow-y:auto}`;
    }
    if(binding.wordpressMenuId && nav){
      if(!runtimeElement('nav-menu'))throw new Error('WordPress navigation widget schema unavailable');
      const discard=new Set([...descendants(nav).slice(1).map(e=>e.id),...links.map(e=>e.id)]);
      for(let i=tree.length-1;i>=0;i--)if(discard.has(tree[i].id)){delete sourceMap[tree[i].id];tree.splice(i,1);}
      const menuSettings={menu:String(binding.wordpressMenuId),menuTypography:{'font-family':'Inter','font-size':'14px','font-weight':'500','line-height':'17px',color:{raw:'#FFFFFF'}},mobileMenu:'custom',mobileMenuCustomBreakpoint:String(bp)};
      nav.name='nav-menu';nav.children=[];
      nav.settings={...menuSettings,menuGap:'44',_width:'auto',_cssCustom:`#brxe-${nav.id} .bricks-nav-menu>li:first-child{display:none} #brxe-${nav.id} .bricks-nav-menu>li{position:relative} #brxe-${nav.id} .bricks-nav-menu>li:not(:first-child):not(:last-child)::after{content:'';position:absolute;right:-22px;top:50%;height:14px;width:1px;background:white;transform:translateY(-50%)}`};
      nav.settings._flexShrink='0';
      nav.settings._cssCustom+=` #brxe-${nav.id} .bricks-nav-menu{gap:44px} #brxe-${nav.id} .bricks-nav-menu>li{margin:0!important;flex-shrink:0} #brxe-${nav.id} .bricks-nav-menu>li>a{white-space:nowrap;padding:0}`;
      const drawerNav=id('wordpress-nav');
      tree.find(e=>e.id===inner).children=[close,drawerNav];
      tree.push({id:drawerNav,name:'nav-menu',parent:inner,children:[],settings:{...menuSettings,mobileMenu:'never',menuAlignment:'column',menuGap:'24',_width:'100%',menuTypography:{...menuSettings.menuTypography,'font-size':'16px'}}});
    }
  }
}
