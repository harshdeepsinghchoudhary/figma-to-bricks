import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import fs from 'node:fs';
export function saveVault(file,values,password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('Use a vault passphrase of 12–256 characters.');
 const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(values),'utf8'),cipher.final()]);
 fs.writeFileSync(file,JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{mode:0o600});key.fill(0);
}
export function unlockVault(file,password){
 try{if(typeof password!=='string'||password.length>256)throw Error();const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1)throw Error();const key=scryptSync(password,Buffer.from(data.salt,'base64'),32),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString());key.fill(0);return value;}catch{throw new Error('Could not unlock the vault. Check the passphrase.');}
}
