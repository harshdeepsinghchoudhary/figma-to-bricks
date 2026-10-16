const colour=s=>String(s?._background?.color?.raw||'').toLowerCase();
const background=s=>JSON.stringify([colour(s),s?._background?.image||null,s?._gradient||null]);
// Preserve the total measured gap. With different backgrounds, give it to
// the page-coloured neighbour; if neither matches, use the following section.
export function sectionGap(a,b,gap,pageColour='',navFirst=false){
 const different=background(a)!==background(b);
 const page=String(pageColour).toLowerCase();
 const plain=s=>!s?._background?.image&&!s?._gradient&&(!colour(s)||colour(s)===page);
 if(different){
  if(plain(a)&&!plain(b))return [gap,0];
  return [0,gap];
 }
 if(navFirst)return [0,gap];
 return [gap/2,gap/2];
}
