import fs from 'node:fs';
import path from 'node:path';
// Only job-owned directories, never symlink targets or persistent sign-in storage.
export function cleanupAgentSessions(jobDir,depth=0){
 if(depth>4||!fs.existsSync(jobDir))return;
 for(const entry of fs.readdirSync(jobDir,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.isSymbolicLink())continue;
  const target=path.join(jobDir,entry.name);
  if(entry.name==='.agent-session')fs.rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  else if(['sections','final'].includes(entry.name)||/^section-[a-zA-Z0-9_-]+$/.test(entry.name))cleanupAgentSessions(target,depth+1);
 }
}
