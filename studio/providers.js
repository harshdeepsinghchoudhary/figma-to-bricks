// Explicit adapters, never arbitrary executable names supplied by users.
export const agentProviders=[
 {id:'codex',label:'Codex SDK',key:'CODEX_API_KEY'},
 {id:'anthropic',label:'Claude API',key:'ANTHROPIC_API_KEY'},
 {id:'gemini',label:'Gemini API',key:'GEMINI_API_KEY'},
 {id:'groq',label:'Groq API',key:'GROQ_API_KEY'},
 {id:'nvidia',label:'NVIDIA API',key:'NVIDIA_API_KEY'},
];
export function agentProvider(env){
 const provider=agentProviders.find(p=>p.id===(env.STUDIO_AGENT_PROVIDER||'codex'));
 if(!provider)throw Error('Choose a supported agent provider.');
 return provider;
}
export function tenantEnvironment(parent,home){
 const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','BROWSER_EXECUTABLE'].filter(k=>parent[k]).map(k=>[k,parent[k]]));
 return {...env,HOME:home,USERPROFILE:home,CODEX_HOME:home+'/.codex',STUDIO_HOSTED:'1'};
}
