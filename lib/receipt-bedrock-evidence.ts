import {ReceiptDraftRepository,type ReceiptScope,type ReceiptDraft} from './receipt-drafts.ts';
import {recordBedrockWorkflowEvidence} from './bedrock-workflow-evidence.ts';

/** This server-only proof concerns durable extraction readback, never expense approval or accuracy. */
export async function confirmReceiptBedrockReadback(database:D1Database,settings:Record<string,unknown>,scope:ReceiptScope,draft:ReceiptDraft,operationId?:string){
 if(!operationId||draft.provider!=='bedrock'||draft.status!=='review-required'||!draft.sourceFacts)return false;
 const saved=await new ReceiptDraftRepository(database).get(scope,draft.id);
 if(saved.version!==draft.version||saved.provider!=='bedrock'||saved.status!=='review-required'||JSON.stringify(saved.sourceFacts)!==JSON.stringify(draft.sourceFacts))return false;
 return recordBedrockWorkflowEvidence(database,settings,{...scope,operationId,scope:saved.mime==='application/pdf'?'saved-pdf-receipt-readback':'saved-image-receipt-readback',proofReference:`${saved.id}:${saved.version}`});
}
