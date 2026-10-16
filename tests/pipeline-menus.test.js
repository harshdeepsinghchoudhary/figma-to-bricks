import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverMenus,provisionMenus,applyHeaderMenus} from '../scripts/pipeline-menus.js';

test('pipeline provisions menus idempotently, preserves links and recreates deleted menus',async()=>{
 const menus=[],items=[];let next=1,posts=0;
 const api=async(route,body)=>{
  if(body){posts++;const value={...body,id:next++};if(route==='menus')menus.push(value);else{value.title={raw:body.title};items.push(value);}return value;}
  const url=new URL('https://test/'+route);
  return url.pathname==='/menus'?menus.filter(m=>m.slug===url.searchParams.get('slug')):items.filter(i=>i.menus===Number(url.searchParams.get('menus')));
 };
 const plans=[{key:'1:2',role:'header',title:'Header',items:['Home','Slots']}];
 const options={api,site:'https://test',frame:'design'};
 const first=await provisionMenus(plans,options);assert.equal(posts,3);
 items[1].url='/my-slots';
 await provisionMenus(plans,{...options,previous:first});assert.equal(posts,3);assert.equal(items[1].url,'/my-slots');
 menus.length=0;
 const recreated=await provisionMenus(plans,{...options,previous:first});assert.notEqual(recreated[0].menuId,first[0].menuId);assert.equal(posts,6);
 const other=await provisionMenus(plans,{...options,site:'https://other',previous:[{...first[0],slug:'foreign-menu'}]});assert.notEqual(other[0].slug,'foreign-menu');
});

test('discovers header labels and footer lists before native conversion',()=>{
 const tree=[{id:'h',parent:0,children:['a','b','c'],settings:{}},...['a','b','c'].map((id,i)=>({id,parent:'h',children:[],name:'text',settings:{text:['Home','Slots','Sports'][i]}})),{id:'f',parent:0,children:['title','list'],settings:{}},{id:'title',parent:'f',children:[],name:'text',settings:{text:'Related'}},{id:'list',parent:'f',children:[],name:'text',settings:{text:'One<br>Two'}}];
 const map=Object.fromEntries(tree.map(e=>[e.id,{figmaNodeId:e.id,normalizedId:e.id==='h'?'header-nav':e.id==='f'?'footer-column':e.id}]));
 const plans=discoverMenus(tree,map);assert.equal(plans.length,2);assert.deepEqual(plans.find(p=>p.role==='footer').items,['One','Two']);
 applyHeaderMenus(tree,map,plans.map(p=>({...p,menuId:42})));
 assert.equal(tree.find(e=>e.name==='nav-menu').settings.mobileMenuCustomBreakpoint,'1024');assert.equal(tree.some(e=>e.id==='a'),false);
});
test('menu binding preserves logo and action in a mixed header',()=>{
 const tree=[{id:'header',children:['logo','a','b','c','cta'],settings:{}},...['logo','a','b','c','cta'].map(id=>({id,parent:'header',children:[],name:id==='logo'?'image':id==='cta'?'button':'text',settings:{text:id}}))];
 const map=Object.fromEntries(tree.map(e=>[e.id,{figmaNodeId:e.id,normalizedId:e.id==='header'?'header-navigation':e.id}]));
 const plans=discoverMenus(tree,map);applyHeaderMenus(tree,map,plans.map(p=>({...p,menuId:1})));
 assert.ok(tree.some(e=>e.id==='logo'));assert.ok(tree.some(e=>e.id==='cta'));assert.equal(tree.find(e=>e.id==='header').children.length,3);
});

test('reuses a same-name menu when WordPress derives a different slug',async()=>{
 const menu={id:77,name:'design - Header',slug:'design-header'};let creates=0;
 const api=async(route,body)=>{
  if(body){creates++;throw new Error('Existing menu must not be created again');}
  if(route.startsWith('menu-items'))return [{title:{raw:'Home'},url:'/edited-home'}];
  return route.includes('search=')?[menu]:[];
 };
 const result=await provisionMenus([{key:'a',role:'header',title:'Header',items:['Home']}],{api,site:'https://test',frame:'design'});
 assert.equal(creates,0);assert.equal(result[0].menuId,77);assert.equal(result[0].slug,'design-header');
});

test('recovers menu_exists race but propagates unrelated failures',async()=>{
 let created=false;
 const options={site:'https://test',frame:'design'};
 const plans=[{key:'a',role:'header',title:'Header',items:[]}];
 const api=async(route,body)=>{
  if(body){created=true;throw Object.assign(new Error('exists'),{code:'menu_exists'});}
  if(route.includes('search=')&&created)return [{id:88,name:'design - Header',slug:'actual'}];
  return [];
 };
 assert.equal((await provisionMenus(plans,{...options,api}))[0].menuId,88);
 await assert.rejects(provisionMenus(plans,{...options,api:async(route,body)=>{if(body)throw Object.assign(new Error('denied'),{code:'rest_forbidden'});return [];}}),/denied/);
});
