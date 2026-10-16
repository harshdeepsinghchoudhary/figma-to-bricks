// Repeating question rows beneath an explicit FAQ heading. Empty answer
// wrappers intentionally contain no invented copy and remain editable.
export function repairSourceFaq(doc){
 const all=n=>[n,...(n.children||[]).flatMap(all)];
 const text=n=>['text','text-basic','heading'].includes(n.type);
 const report=[];
 function visit(n){
  if(n.component?.kind==='accordion')return;
  const heading=(n.children||[]).find(c=>text(c)&&/^(faq|frequently asked questions)$/i.test(c.text?.trim()||''));
  if(heading){
   const rest=n.children.filter(c=>c!==heading),flat=rest.flatMap(all);
   const questions=flat.filter(c=>text(c)&&/\?\s*$/.test(c.text||'')&&(c.text||'').length<200);
   if(questions.length>=3){
    const rows=questions.map(q=>flat.find(c=>(c.children||[]).includes(q))||q);
    if(rows.every((r,i)=>all(r).filter(text).length===1)){
     const prose=flat.filter(c=>text(c)&&!questions.includes(c));
     const items=questions.map((q,i)=>{
      const y=q.figma?.absoluteBoundingBox?.y;
      const next=questions[i+1]?.figma?.absoluteBoundingBox?.y??Infinity;
      const answers=prose.filter(a=>{const ay=a.figma?.absoluteBoundingBox?.y;return Number.isFinite(y)&&ay>y&&ay<next;});
      const title={type:'row',id:`${q.id}-faq-title`,component:{role:'accordion-title'},layout:{display:'flex',direction:'row',align:'center',justify:'space-between'},children:rows[i]===q?[q]:rows[i].children};
      return {type:'block',id:`${q.id}-faq-item`,children:[title,{type:'column',id:`${q.id}-faq-answer`,component:{role:'accordion-content'},children:answers}]};
     });
     const assigned=items.flatMap(i=>i.children[1].children);
     if(assigned.length===prose.length){
      const openIndex=items.findIndex(i=>i.children[1].children.length);
      n.children=[heading,{type:'column',id:`${n.id}-faq`,component:{kind:'accordion',options:openIndex>=0?{openIndex}:{}},children:items}];
      report.push(`${n.id}: ${items.length} question rows -> editable FAQ accordion`);return;
     }
    }
   }
  }
  for(const c of n.children||[])visit(c);
 }
 visit(doc);return report;
}
