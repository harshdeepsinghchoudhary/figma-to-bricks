import test from 'node:test';
import assert from 'node:assert/strict';
import {responsiveContent} from '../scripts/responsive-content.js';
test('content images expand on tablet while compact logos and pinned artwork keep their sizing',()=>{
 const tree=[{id:'photo',name:'image',settings:{_widthMax:'381px'}},{id:'logo',name:'image',settings:{_widthMax:'86px'}},{id:'layer',name:'image',settings:{_widthMax:'400px',_position:'absolute'}}];
 responsiveContent(tree);
 assert.equal(tree[0].settings['_widthMax:tablet_portrait'],'100%');assert.equal(tree[1].settings['_widthMax:tablet_portrait'],undefined);assert.equal(tree[2].settings['_widthMax:tablet_portrait'],undefined);
});
test('footer column row wraps without changing inner text columns',()=>{
 const tree=[{id:'footer',name:'div',children:['a','b'],settings:{_direction:'row'}},...['a','b'].map(id=>({id,parent:'footer',name:'div',children:[],settings:{_direction:'column',_widthMax:'392px'}}))];
 responsiveContent(tree,{footer:{normalizedId:'footer-area-row'}});
 assert.equal(tree[0].settings['_direction:tablet_portrait'],'row');assert.equal(tree[0].settings['_flexWrap:tablet_portrait'],'wrap');assert.match(tree[0].settings._cssCustom,/flex-basis:100%/);assert.equal(tree[1].settings._direction,'column');
});
