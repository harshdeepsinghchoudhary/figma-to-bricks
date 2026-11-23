// Validate before deployment. One correction request, then report unsupported
// proposals without applying them or aborting the remaining page sections.
export async function validatedProposal({request,validate,event=()=>{},correctionInstructions='Return a corrected complete proposal using only permitted settings. Never use _cssCustom or arbitrary CSS. If the fix is unsupported, report the problem in issues and return patches: [].'}){
 let feedback='',last;
 for(let attempt=0;attempt<2;attempt++){
  try{const proposal=await request(feedback);await validate(proposal);return proposal;}catch(error){
   last=error.message;
   event({stage:'proposal-rejected',attempt:attempt+1,reason:last});
   feedback=`Your previous proposal was rejected: ${last}. ${correctionInstructions}`;
  }
 }
 return {issues:[{severity:'high',description:`Automatic repair could not produce a permitted patch after two attempts: ${last}`}],patches:[],rejectedReason:last};
}
