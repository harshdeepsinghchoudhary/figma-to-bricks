import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const client=new Client({name:'studio-mcp-smoke',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('studio/mcp-server.js')],stderr:'pipe'});
async function call(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:180000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text)}
try{
 await client.connect(transport);const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='create_wordpress_draft'));
 const bad=await client.callTool({name:'get_job',arguments:{jobId:'../../.env'}});assert.equal(bad.isError,true);
 const designs=await call('list_designs');assert.ok(designs.some(d=>d.name==='pgslot-thailand-com-84cdd226'));
 if(process.argv.includes('--compile')){let j=await call('compile_design',{frame:'pgslot-thailand-com-84cdd226',mode:'deterministic'});for(let i=0;i<180;i++){const state=await call('get_job',{jobId:j.jobId});if(state.status!=='running'){assert.equal(state.status,'completed',state.error);break}await new Promise(r=>setTimeout(r,1000));if(i===179)throw Error('Compile timeout')}}
 const c=await call('create_candidate',{frame:'pgslot-thailand-com-84cdd226'});
 const inspection=await call('inspect_design',{candidateId:c.candidateId,nodeId:'202:327'});assert.ok(inspection.elements.length);
 const v=await call('validate_candidate',{candidateId:c.candidateId});assert.equal(v.errors.length,0);
 const element=inspection.elements.find(e=>e.name==='heading')||inspection.elements[0];assert.ok(element);
 const rejected=await client.callTool({name:'apply_settings',arguments:{candidateId:c.candidateId,patches:[{op:'settings',id:element.id,set:{_cssCustom:'body{display:none}'}}]}});assert.equal(rejected.isError,true);
 await call('apply_settings',{candidateId:c.candidateId,patches:[{op:'settings',id:element.id,set:{_padding:{top:'40',right:'20',bottom:'40',left:'20'}}}]});
 const preview=await call('capture_preview',{candidateId:c.candidateId,width:390});assert.equal(preview.metrics[0].width,390);
 const img=await client.callTool({name:'get_image',arguments:{candidateId:c.candidateId,kind:'preview',width:390}});assert.equal(img.content[0].type,'image');
 const output=await call('export_candidate',{candidateId:c.candidateId});assert.ok(fs.existsSync(output.path));
 console.log('Real MCP stdio workflow passed: discovery, validation, scoped inspection, rejected unsafe patch, candidate patch, browser capture/image and export. No model requests or WordPress writes.');
}finally{await client.close()}
