// Wide centred boxes distinguish content containers from repeated half columns.
export function inferSiteWidth(root){
 const page=(root.document||root).absoluteBoundingBox;if(!page?.width)return 0;
 const counts=new Map(),topCounts=new Map();
 function visit(n,depth){
  if(n.visible===false||depth>4)return;
  const b=n.absoluteBoundingBox,w=Math.round(b?.width||0);
  if(depth&&b&&n.type!=='TEXT'&&w>=page.width*.55&&w<page.width*.99&&Math.abs(b.x+b.width/2-page.x-page.width/2)<4){counts.set(w,(counts.get(w)||0)+1);if(depth===1)topCounts.set(w,(topCounts.get(w)||0)+1);}
  for(const c of n.children||[])visit(c,depth+1);
 }
 visit(root.document||root,0);
 return [...(topCounts.size?topCounts:counts)].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]?.[0]||0;
}
