import fs from 'node:fs';
import path from 'node:path';
export function recordUsage(file,entry){
 if(!file)return;
 let data={calls:[]};try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 data.calls.push({at:new Date().toISOString(),...entry});
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2));
}
export function reviewBudget(file,maxCalls=8,maxInputCharacters=400000){
 let calls=0,characters=0;
 return {take(length){if(calls>=maxCalls||characters+length>maxInputCharacters)return false;calls++;characters+=length;recordUsage(file,{phase:'browser-review',inputCharacters:length,tokenUsage:null});return true;},summary(){let rows=[];try{rows=JSON.parse(fs.readFileSync(file,'utf8')).calls;}catch{}return {calls,inputCharacters:characters,maxCalls,maxInputCharacters,normalizationCalls:rows.filter(r=>r.phase==='normalization').length,reportedTokens:rows.reduce((n,r)=>n+(r.tokenUsage?.input_tokens||0)+(r.tokenUsage?.output_tokens||0),0),note:'Reported tokens exclude providers that return no usage; not a billing estimate.'};}};
}
