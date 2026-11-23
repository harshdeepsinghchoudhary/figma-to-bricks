import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRootCauses,compactRootCauseContext} from '../studio/root-cause-evidence.js';

function fixture(){
 const box=(x,y,width,height)=>({x,y,width,height});
 const title={id:'text-source',type:'TEXT',characters:'Source title',absoluteBoundingBox:box(-2800,1200,320,40),style:{fontFamily:'Inter',fontSize:32,fontWeight:600,lineHeightPx:40},fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]};
 const section={id:'section-source',type:'FRAME',absoluteBoundingBox:box(-3000,1000,1440,500),children:[title]};
 return {
  rawRoot:{id:'page-source',type:'FRAME',absoluteBoundingBox:box(-3000,0,1440,2000),children:[section]},
  sectionSourceId:'section-source',sectionRootIds:['section'],
  normalized:{type:'page',children:[{id:'section-norm',type:'section',figmaNodeId:'section-source',children:[{id:'title-norm',type:'heading',figmaNodeId:'text-source',text:'Source title',size:{width:320,height:40},typography:{fontFamily:'Inter',fontSize:32,fontWeight:600,lineHeight:'40px'}}]}]},
  tree:[{id:'section',parent:0,name:'section',children:['title'],settings:{}},{id:'title',parent:'section',name:'heading',children:[],settings:{text:'Source title',_typography:{'font-family':'Inter','font-size':'32px','font-weight':'600','line-height':'40px'}}}],
  sourceMap:{section:{normalizedId:'section-norm',figmaNodeId:'section-source'},title:{normalizedId:'title-norm',figmaNodeId:'text-source'}},
  metrics:[{width:1440,elements:[{id:'section',x:0,y:2500,width:1440,height:500,display:'flex'},{id:'title',x:200,y:2700,width:320,height:40,display:'block',fontFamily:'Inter, sans-serif',fontSize:'32px',fontWeight:'600',lineHeight:'40px',color:'rgb(0, 0, 0)'}]}],
  manifest:[]
 };
}

test('geometry is compared at equal viewport scale using section-relative coordinates',()=>{
 const input=fixture(),report=analyzeRootCauses(input);
 assert.deepEqual(report.findings,[]);
 input.metrics[0].elements[1].x=220;
 const finding=analyzeRootCauses(input).findings.find(f=>f.category==='positioning');
 assert.deepEqual(finding.expected,{x:200});assert.deepEqual(finding.observed,{x:220});
 assert.equal(finding.sourceId,'text-source');assert.equal(finding.normalizedId,'title-norm');assert.equal(finding.elementId,'title');
});

test('dimension and typography reports trace the first recorded differing stage',()=>{
 const input=fixture();input.normalized.children[0].children[0].size.width=400;input.metrics[0].elements[1].width=400;
 input.normalized.children[0].children[0].typography.fontSize=24;input.tree[1].settings._typography['font-size']='24px';input.metrics[0].elements[1].fontSize='24px';
 input.tree[1].settings._typography['font-weight']='400';input.metrics[0].elements[1].fontWeight='400';
 const report=analyzeRootCauses(input);
 assert.equal(report.findings.find(f=>f.expected.width===320).stage,'normalization');
 assert.equal(report.findings.find(f=>f.expected.fontSize===32).stage,'normalization');
 assert.equal(report.findings.find(f=>f.expected.fontWeight===600).stage,'compiler');
});

test('smaller viewports detect broken content without inventing a responsive Figma reference',()=>{
 const input=fixture();input.metrics[0].width=390;input.metrics[0].elements[1].width=220;input.metrics[0].elements[1].fontSize='20px';input.metrics[0].elements[1].clippedText=true;
 const report=analyzeRootCauses(input);
 assert.equal(report.findings.length,1);assert.equal(report.findings[0].observed.clippedText,true);assert.equal(report.findings[0].referenceAvailable,false);
});

test('hidden source, exported descendants and absorbed button labels are not reported as missing',()=>{
 const input=fixture(),section=input.rawRoot.children[0],norm=input.normalized.children[0];
 section.children.push({id:'hidden',type:'FRAME',visible:false,children:[{id:'hidden-text',type:'TEXT',characters:'Do not restore'}]},{id:'art',type:'GROUP',children:[{id:'painted-text',type:'TEXT',characters:'Part of artwork'}]},{id:'button-source',type:'FRAME',children:[{id:'button-label',type:'TEXT',characters:'Buy now'}]});
 norm.children.push({id:'art-norm',type:'image',figmaNodeId:'art',asset:{nodeId:'art'}},{id:'button-norm',type:'button',figmaNodeId:'button-source',text:'Buy now'});
 const report=analyzeRootCauses(input);
 assert.equal(report.mappings.find(m=>m.sourceId==='hidden-text').status,'hidden-source');
 assert.equal(report.mappings.find(m=>m.sourceId==='painted-text').status,'exported-descendant');
 assert.equal(report.mappings.find(m=>m.sourceId==='button-label').status,'button-label');
 assert.equal(report.findings.filter(f=>f.category==='missing-content').length,0);
 // The missing export is diagnosed at the owner, not as missing text children.
 assert.equal(report.findings.find(f=>f.category==='assets').sourceId,'art');
});

test('missing source text and unobserved compiled nodes have distinct confidence and stages',()=>{
 const input=fixture();input.rawRoot.children[0].children.push({id:'missing',type:'TEXT',characters:'A missing sentence'});
 input.metrics[0].elements=input.metrics[0].elements.filter(e=>e.id!=='title');
 const report=analyzeRootCauses(input);
 const missing=report.findings.find(f=>f.sourceId==='missing');assert.equal(missing.category,'missing-content');assert.equal(missing.stage,'normalization');assert.equal(missing.confidence,'high');
 const unobserved=report.findings.find(f=>f.sourceId==='text-source');assert.equal(unobserved.category,'missing-element');assert.equal(unobserved.confidence,'medium');
});

test('bypassed source paint boundary is a hierarchy hypothesis and synthetic wrappers are transparent',()=>{
 const input=fixture(),section=input.rawRoot.children[0],title=section.children[0],norm=input.normalized.children[0],heading=norm.children[0];
 section.children=[{id:'panel',type:'FRAME',fills:[{type:'SOLID',color:{r:1,g:0,b:0}}],children:[title]}];
 norm.children=[{id:'panel-norm',type:'column',figmaNodeId:'panel',children:[]},{id:'synthetic',type:'row',children:[heading]}];
 const report=analyzeRootCauses(input),finding=report.findings.find(f=>f.category==='hierarchy'&&f.sourceId==='text-source');
 assert.equal(finding.expected.parentSourceId,'panel');assert.equal(finding.observed.parentSourceId,'section-source');assert.equal(finding.confidence,'medium');
 norm.children[0].children=[norm.children[1]];norm.children.pop();
 assert.equal(analyzeRootCauses(input).findings.filter(f=>f.category==='hierarchy').length,0);
});

test('explicit Auto Layout spacing provides measured expected values',()=>{
 const input=fixture(),section=input.rawRoot.children[0];section.layoutMode='HORIZONTAL';section.paddingLeft=24;section.itemSpacing=16;
 input.metrics[0].elements[0].padding='0px 0px 0px 40px';input.metrics[0].elements[0].columnGap='8px';
 const findings=analyzeRootCauses(input).findings.filter(f=>f.category==='spacing');
 assert.equal(findings.length,2);assert.deepEqual(findings[0].expected,{paddingLeft:24});assert.deepEqual(findings[1].expected,{gap:16});
});

test('compiler dimensions, source paint and explicit alignment stay traceable to their evidence',()=>{
 const input=fixture(),section=input.rawRoot.children[0];section.layoutMode='HORIZONTAL';section.primaryAxisAlignItems='CENTER';section.counterAxisAlignItems='CENTER';section.cornerRadius=16;section.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];
 Object.assign(input.metrics[0].elements[0],{backgroundColor:'rgb(0, 0, 255)',borderRadius:'8px',flexDirection:'column',justifyContent:'flex-start',alignItems:'flex-start'});
 input.tree[1].settings._width='400px';input.metrics[0].elements[1].width=400;
 const findings=analyzeRootCauses(input).findings;
 assert.equal(findings.find(f=>f.expected.width===320).stage,'compiler');
 assert.deepEqual(findings.find(f=>f.expected.backgroundRgba).expected.backgroundRgba,[255,0,0,1]);
 assert.equal(findings.find(f=>f.expected.direction).expected.direction,'row');
 assert.equal(findings.find(f=>f.expected.borderRadius).expected.borderRadius,16);
});

test('missing section origin does not fabricate source-position differences',()=>{
 const input=fixture();input.sectionRootIds=[];delete input.sourceMap.section;input.metrics[0].elements=input.metrics[0].elements.filter(e=>e.id!=='section');
 // The normalized fallback still maps the section when normalizedId is known;
 // deleting the whole source mapping means no trustworthy rendered anchor.
 const findings=analyzeRootCauses(input).findings;
 assert.equal(findings.filter(f=>f.category==='positioning').length,0);
});

test('compact context is bounded and never contains raw asset URLs or source payloads',()=>{
 const input=fixture();input.rawRoot.children[0].children.push({id:'missing',type:'TEXT',characters:'Missing'});input.tree[1].settings._background={image:{url:'https://secret.example/image?token=private'}};
 const report=analyzeRootCauses(input),context=compactRootCauseContext(report,{maxFindings:0,maxMappings:1});
 assert.equal(context.truncated,true);assert.equal(context.findings.length,0);assert.equal(context.mappings.length,1);assert.equal(JSON.stringify(context).includes('secret.example'),false);
});
