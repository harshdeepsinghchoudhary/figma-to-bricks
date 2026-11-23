import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSection} from '../scripts/conversion-audit.js';
import {compactReviewContext} from '../studio/section-evidence.js';
import {reviewBudget} from '../studio/usage.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {sectionEvidence} from '../studio/section-evidence.js';
import {sectionFingerprint} from '../studio/review-checkpoint.js';
test('static audit catches negative padding and missing normalized content',()=>{
 const result=auditSection({type:'page',children:[{id:'hero',type:'section',children:[{id:'title',type:'heading',text:'Required heading'}]}]},[{id:'abcdef',name:'section',settings:{_padding:{left:'-12'}}}],{},[]);
 assert.ok(result.some(i=>i.kind==='invalid-padding'&&i.severity==='error'));
 assert.ok(result.some(i=>i.kind==='content-mapping'));
});
test('AI review context omits generated CSS and embedded image payloads',()=>{
 const result=compactReviewContext([{id:'a',settings:{_width:'100%',_cssCustom:'large generated CSS',image:{url:'data:image/png;base64,large'},_background:{image:'large'}}}],[],[]);
 assert.deepEqual(result.elements[0].settings,{_width:'100%'});
});
test('browser review budget stops before exceeding either request or context limits',()=>{
 const b=reviewBudget(null,2,100);assert.equal(b.take(60),true);assert.equal(b.take(50),false);assert.equal(b.take(40),true);assert.equal(b.take(0),false);assert.equal(b.summary().calls,2);
});
test('section checkpoints invalidate on their own subtree edits but not unrelated sections',()=>{
 const tree=[{id:'a',parent:0},{id:'b',parent:'a',settings:{_width:'100px'}},{id:'c',parent:0}];const section={rootIds:['a']};
 const before=sectionFingerprint(tree,section);tree[2].settings={_width:'20px'};assert.equal(sectionFingerprint(tree,section),before);
 tree[1].settings._width='200px';assert.notEqual(sectionFingerprint(tree,section),before);
});
test('section comparison isolates a correct section from an earlier section height error',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'section-evidence-'));
 try{
  const ref=path.join(dir,'ref.png'),actual=path.join(dir,'actual.png');
  const blue=await sharp({create:{width:100,height:50,channels:3,background:'blue'}}).png().toBuffer();
  await sharp({create:{width:100,height:100,channels:3,background:'red'}}).composite([{input:blue,top:50,left:0}]).png().toFile(ref);
  await sharp({create:{width:100,height:120,channels:3,background:'red'}}).composite([{input:blue,top:70,left:0}]).png().toFile(actual);
  const result=await sectionEvidence({reference:ref,actual,dir,width:100,sourceBox:{y:50,height:50},rootBox:{y:0},metrics:{elements:[{id:'blue',x:0,y:70,width:100,height:50}]},ids:new Set(['blue'])});
  assert.equal(result.pixelError,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
