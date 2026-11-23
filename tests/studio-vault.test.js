import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {saveVault,unlockVault} from '../studio/vault.js';
test('connection vault encrypts secrets and rejects wrong passwords and tampering',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-vault-')),file=path.join(dir,'vault');
 try{
  const secret='fixture-private-token';saveVault(file,{FIGMA_TOKEN:secret},'test passphrase 1234');
  assert.ok(!fs.readFileSync(file,'utf8').includes(secret));
  assert.deepEqual(unlockVault(file,'test passphrase 1234'),{FIGMA_TOKEN:secret});
  assert.throws(()=>unlockVault(file,'wrong password'),/unlock/);
  const data=JSON.parse(fs.readFileSync(file));data.tag=Buffer.alloc(16).toString('base64');fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>unlockVault(file,'test passphrase 1234'),/unlock/);
  assert.throws(()=>saveVault(file,{},'short'),/passphrase/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
