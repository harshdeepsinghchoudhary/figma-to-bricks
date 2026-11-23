import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {accounts} from '../studio/accounts.js';
import {tenantEnvironment,agentProvider} from '../studio/providers.js';
test('account sessions are owner-scoped, revocable, and passwords are hashed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-accounts-')),file=path.join(dir,'accounts.sqlite'),store=accounts(file);
 try{
  const a=await store.register('a@example.test','test-password-a'),b=await store.register('b@example.test','test-password-b');
  const token=store.session(a);assert.equal(store.user(token).id,a.id);assert.notEqual(store.user(token).id,b.id);
  await assert.rejects(store.login('a@example.test','test-password-b'),/Invalid/);
  assert.equal((await store.login('a@example.test','test-password-a')).id,a.id);
  store.logout(token);assert.equal(store.user(token),null);
 }finally{store.close();assert.ok(!fs.readFileSync(file).includes(Buffer.from('test-password-a')));fs.rmSync(dir,{recursive:true,force:true})}
});
test('tenant subprocesses never inherit operator credentials or home directories',()=>{
 const env=tenantEnvironment({PATH:'bin',HOME:'/owner',CODEX_HOME:'/owner/.codex',CODEX_API_KEY:'owner-key',ANTHROPIC_API_KEY:'owner-key',WP_API_PASSWORD:'owner-password',STUDIO_INVITE_CODE:'private'},'/tenant/home');
 assert.equal(env.HOME,'/tenant/home');assert.equal(env.CODEX_HOME,'/tenant/home/.codex');assert.ok(!JSON.stringify(env).includes('owner'));assert.equal(env.STUDIO_INVITE_CODE,undefined);
 assert.equal(agentProvider({STUDIO_AGENT_PROVIDER:'anthropic'}).key,'ANTHROPIC_API_KEY');assert.throws(()=>agentProvider({STUDIO_AGENT_PROVIDER:'arbitrary-shell'}));
});
