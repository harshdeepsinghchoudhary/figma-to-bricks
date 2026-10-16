import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionGap} from '../scripts/section-gap.js';
const fill=raw=>({_background:{color:{raw}}});
test('same background splits measured gap without increasing total',()=>{
 assert.deepEqual(sectionGap(fill('#ABCDEF'),fill('#abcdef'),81,'#abcdef'),[40.5,40.5]);
});
test('different backgrounds keep the entire gap on the page-coloured side',()=>{
 assert.deepEqual(sectionGap(fill('#111111'),fill('#222222'),80,'#111111'),[80,0]);
 assert.deepEqual(sectionGap(fill('#222222'),fill('#111111'),80,'#111111'),[0,80]);
 assert.deepEqual(sectionGap(fill('#222222'),fill('#333333'),80,'#111111'),[0,80]);
});
test('image and gradient boundaries also keep gaps whole',()=>{
 assert.deepEqual(sectionGap(fill('#111111'),{_gradient:{angle:90}},80,'#111111'),[80,0]);
 assert.deepEqual(sectionGap({_background:{image:{url:'a.png'}}},fill('#111111'),80,'#111111'),[0,80]);
});
