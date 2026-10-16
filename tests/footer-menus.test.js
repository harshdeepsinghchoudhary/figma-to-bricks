import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverFooterMenus,applyFooterMenus} from '../scripts/footer-menus.js';
test('footer heading and multiline list become a WordPress menu without a mobile hamburger',()=>{
 const tree=[{id:'f',children:['h','l'],settings:{}},{id:'h',parent:'f',name:'text',settings:{text:'<p>Subject</p>'}},{id:'l',parent:'f',name:'text',settings:{text:'<p>One<br>Two</p>',_typography:{'font-size':'16px'}}}];
 const map={f:{normalizedId:'footer-column'},h:{figmaNodeId:'h'},l:{figmaNodeId:'l'}};
 const bindings=discoverFooterMenus(tree,map);assert.deepEqual(bindings[0].items,['One','Two']);
 applyFooterMenus(tree,map,[{...bindings[0],menuId:23}]);
 assert.equal(tree[1].name,'heading');assert.equal(tree[2].name,'nav-menu');assert.equal(tree[2].settings.mobileMenu,'never');assert.equal(tree[2].settings.menuAlignment,'column');assert.equal(tree[2].settings.menu,'23');
});
test('ordinary content lists outside the footer are not converted',()=>{
 assert.deepEqual(discoverFooterMenus([{id:'x',children:[],settings:{}}],{}),[]);
});
