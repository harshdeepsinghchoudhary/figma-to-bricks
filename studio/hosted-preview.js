// Multi-user private preview. Loopback only until container/egress deployment is ready.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {accounts} from './accounts.js';
import {tenantEnvironment} from './providers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function prepareTenant(base,id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid account ID.');
 const dir=path.join(base,'users',id);fs.mkdirSync(dir,{recursive:true});
 // Copy application code only. Never copy .env, output, local auth, or site schemas.
 for(const name of ['scripts','studio'])fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true,filter:p=>!['node_modules','.env'].includes(path.basename(p))});
 fs.mkdirSync(path.join(dir,'schema'),{recursive:true});
 for(const name of fs.readdirSync(path.join(root,'schema')))if(name.endsWith('.json'))fs.copyFileSync(path.join(root,'schema',name),path.join(dir,'schema',name));
 fs.copyFileSync(path.join(root,'package.json'),path.join(dir,'package.json'));
 if(!fs.existsSync(path.join(dir,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 for(const name of ['output','home'])fs.mkdirSync(path.join(dir,name),{recursive:true});
 return dir;
}
export function createHostedPreview({dataDir=path.join(root,'.studio-hosted'),invite=process.env.STUDIO_INVITE_CODE,launch=spawn}={}){
 if(!invite||invite.length<16)throw Error('Set STUDIO_INVITE_CODE to a random value of at least 16 characters.');
 fs.mkdirSync(dataDir,{recursive:true});const store=accounts(path.join(dataDir,'accounts.sqlite')),workers=new Map(),attempts=new Map();
 async function worker(user){
  if(workers.has(user.id))return workers.get(user.id);
  if(workers.size>=4)throw Error('Preview worker capacity reached. Restart after testing or try later.');
  const pending=new Promise((resolve,reject)=>{
   const dir=prepareTenant(dataDir,user.id),child=launch(process.execPath,[path.join(dir,'studio/server.js')],{cwd:dir,env:{...tenantEnvironment(process.env,path.join(dir,'home')),STUDIO_PORT:'0'},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let buffer='';const timer=setTimeout(()=>{child.kill();reject(Error('Workspace startup timed out.'))},20000);timer.unref();
   child.stdout.on('data',d=>{buffer=(buffer+d).slice(-2000);const m=buffer.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([a-f0-9]{64})/);if(m){clearTimeout(timer);resolve({port:Number(m[1]),token:m[2],child})}});
   child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Error('Workspace could not start.'))});child.on('exit',()=>{clearTimeout(timer);workers.delete(user.id);reject(Error('Workspace stopped.'))});
  });workers.set(user.id,pending);try{return await pending}catch(e){workers.delete(user.id);throw e}
 }
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const origin=`http://127.0.0.1:${server.address().port}`;
   if(req.headers.host!==new URL(origin).host)return send(403,{error:'Private preview is loopback-only.'});
   const url=new URL(req.url,origin),token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('account='))?.slice(8),user=store.user(token);
   if(req.method==='POST'&&req.headers.origin!==origin)return send(403,{error:'Same-origin requests required.'});
   if(url.pathname==='/api/account'&&req.method==='GET')return send(200,{hosted:true,user});
   if(['/api/account/login','/api/account/register','/api/account/logout'].includes(url.pathname)&&req.method==='POST'){
    const ip=req.socket.remoteAddress,count=attempts.get(ip)||{n:0,until:Date.now()+60000};if(count.until<Date.now()){count.n=0;count.until=Date.now()+60000}attempts.set(ip,count);if(++count.n>15)return send(429,{error:'Too many attempts. Wait one minute.'});
    let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return send(413,{error:'Request too large.'})}const input=JSON.parse(raw||'{}');
    if(url.pathname.endsWith('/logout')){store.logout(token);res.setHeader('Set-Cookie','account=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true})}
    if(url.pathname.endsWith('/register')&&input.invite!==invite)return send(403,{error:'A valid private-beta invite is required.'});
    const account=url.pathname.endsWith('/register')?await store.register(input.email,input.password):await store.login(input.email,input.password);
    res.setHeader('Set-Cookie',`account=${store.session(account)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return send(200,{user:account});
   }
   if(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname)){
    const file=path.join(root,'studio/dist',url.pathname==='/'?'index.html':url.pathname.slice(1));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'"});return res.end(fs.readFileSync(file));
   }
   if(!user)return send(401,{error:'Sign in to your account.'});
   if(!url.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
   const target=await worker(user);
   const upstream=http.request({host:'127.0.0.1',port:target.port,path:url.pathname+url.search,method:req.method,headers:{'content-type':req.headers['content-type']||'application/json',host:`127.0.0.1:${target.port}`,origin:`http://127.0.0.1:${target.port}`,cookie:`studio=${target.token}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
   upstream.on('error',()=>send(502,{error:'Workspace unavailable.'}));req.pipe(upstream);
  }catch(e){send(400,{error:e.message})}
 });
 return {server,close:async()=>{for(const pending of workers.values()){try{(await pending).child.kill()}catch{}}store.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createHostedPreview();app.server.listen(4318,'127.0.0.1',()=>console.log('Private multi-user preview: http://127.0.0.1:4318'));
}
