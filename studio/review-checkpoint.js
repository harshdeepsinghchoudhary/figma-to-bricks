import {createHash} from 'node:crypto';
export function sectionFingerprint(tree,section){
 const ids=new Set(section.rootIds||[]);let changed=true;
 while(changed){changed=false;for(const e of tree)if(ids.has(e.parent)&&!ids.has(e.id)){ids.add(e.id);changed=true;}}
 return createHash('sha256').update(JSON.stringify(tree.filter(e=>ids.has(e.id)))).digest('hex');
}
