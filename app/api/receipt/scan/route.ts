import {z} from 'zod';
import {workspaceAccess,loadAccess,checkOrigin,requireEdit,apiError,db} from '@/lib/store';
import {ReceiptDraftRepository,draftReceipt,receiptReviewFields,receiptExtractionSchema} from '@/lib/receipt-drafts';
import {parseReceiptText} from '@/lib/receipt-ocr';
import {invoiceJson} from '@/lib/plan-invoices';
import {BackendError} from '@/lib/backend-errors';
import {planCurrency} from '@/lib/money';
import {planMembers} from '@/lib/model';
const input=z.object({tripId:z.string().min(1).max(180),draftId:z.string().uuid(),version:z.number().int().min(0).safe(),
 text:z.string().trim().min(1).max(32000),confidence:z.number().min(0).max(100).optional(),source:z.enum(['device','pasted']).default('device')}).strict();
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to scan your receipt.',401);
 const parsed=input.safeParse(await invoiceJson(request,40000));if(!parsed.success)throw new BackendError('INVALID_SCAN','Provide readable receipt text and the current saved upload.');
 const body=parsed.data,scope={owner:access.id,planId:body.tripId,memberId:access.user.id},repository=new ReceiptDraftRepository(db());
 // Conceal inaccessible draft identities before loading or initializing any workspace.
 const prior=await repository.get(scope,body.draftId);
 const state=await loadAccess(access);requireEdit(access,state);
 if(state.plan.id!==body.tripId)throw new BackendError('PLAN_CHANGED','Open the plan that owns this receipt.',409);
 if(prior.status==='reviewed')throw new BackendError('RECEIPT_REVIEWED','This source was already reviewed. Upload a new photo for a new scan.',409);
 if(prior.status==='extracting'&&Date.parse(prior.updated)+60000>Date.now())throw new BackendError('RECEIPT_EXTRACTING','Wait for the current extraction to finish.',409);
 const facts=receiptExtractionSchema.parse(parseReceiptText(body.text));
 const warnings=[...facts.flags,...(body.confidence!==undefined&&body.confidence<75?['Some print was difficult to read. Check every item and total carefully or scan again.']:[])];
 const draft=await repository.extracted(scope,body.draftId,body.version,{facts,warnings,provider:body.source==='device'?'device-ocr':'manual-text',modelId:body.source==='device'?'tesseract-6.0.1':'receipt-text-parser'});
 const payer=planMembers(state).some(person=>person.id===access.user!.id)?access.user.id:'sam';
 return Response.json({draft,receipt:draftReceipt(draft,state,payer),reviewFields:receiptReviewFields(draft,planCurrency(state.plan)),
  note:facts.items.length?`${facts.items.length} items added to your receipt draft. Review the photo and assign who had each item.`:'No item prices were readable. Try a clearer photo or paste the receipt text.'},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
