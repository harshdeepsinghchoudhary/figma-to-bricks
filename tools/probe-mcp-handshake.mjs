// Read-only handshake diagnostics; never print credentials or session IDs.
const endpoint = process.env.WP_API_URL;
const headers = {'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Basic '+Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64')};
let id=0;
async function send(method,notify=false){
 const body={jsonrpc:'2.0',method,params:method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'handshake-probe',version:'1'}}:{}};
 if(!notify)body.id=++id;
 const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const raw=await r.text();
 if(r.headers.get('mcp-session-id'))headers['Mcp-Session-Id']=r.headers.get('mcp-session-id');
 let data;try{data=JSON.parse(raw)}catch{}
 console.log(JSON.stringify({method,status:r.status,bytes:raw.length,session:!!headers['Mcp-Session-Id'],protocol:data?.result?.protocolVersion,tools:data?.result?.tools?.map(t=>t.name),rpcError:data?.error?.code}));
 return data;
}
const init=await send('initialize');
if(init?.result?.protocolVersion&&!process.argv.includes('--omit-protocol-header'))headers['MCP-Protocol-Version']=init.result.protocolVersion;
await send('notifications/initialized',true);
await send('tools/list');
