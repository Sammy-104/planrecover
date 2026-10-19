import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {workspaceAccess,loadAccess,checkOrigin,requireEdit,apiError,db} from '@/lib/store';
import {ReceiptDraftRepository,draftReceipt,receiptReviewFields} from '@/lib/receipt-drafts';
import {extractReceipt} from '@/lib/receipt-extraction';
import {acquireAiLease} from '@/lib/ai-usage';
import {invoiceJson} from '@/lib/plan-invoices';
import {BackendError} from '@/lib/backend-errors';
import {planCurrency} from '@/lib/money';
import {planMembers} from '@/lib/model';
import {confirmReceiptBedrockReadback} from '@/lib/receipt-bedrock-evidence';
const schema=z.object({tripId:z.string().min(1).max(180),draftId:z.string().uuid(),version:z.number().int().nonnegative().safe()}).strict();
export async function POST(request:Request){try{
 checkOrigin(request);const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to retry receipt extraction.',401);
 const body=schema.parse(await invoiceJson(request,1000)),scope={owner:access.id,planId:body.tripId,memberId:access.user.id},repository=new ReceiptDraftRepository(db());
 const prior=await repository.get(scope,body.draftId);
 const state=await loadAccess(access);requireEdit(access,state);
 if(access.share&&access.share.tripId!==body.tripId||state.plan.id!==body.tripId)throw new BackendError('PLAN_CHANGED','Open the plan that owns this receipt.',409);
 if(prior.version!==body.version)throw new BackendError('VERSION_CONFLICT','Another change was saved. Refresh before retrying.',409);
 if(prior.status==='reviewed')throw new BackendError('RECEIPT_REVIEWED','This source was reviewed. Upload a new source to change its evidence.',409);
 if(prior.status==='extracting'&&Date.parse(prior.updated)+60000>Date.now())throw new BackendError('RECEIPT_EXTRACTING','Wait for the current extraction to finish.',409);
 const managed=await db().prepare('SELECT status FROM receipt_objects WHERE file_key=?').bind(prior.fileKey).first<{status:string}>();
 if(managed&&managed.status!=='ready')throw new BackendError('RECEIPT_SOURCE_RETIRED','This receipt source is unavailable. Upload a new source.',409);
 if(!env.BUCKET)throw new BackendError('RECEIPT_STORAGE','Receipt storage is unavailable.',503);
 const source=await env.BUCKET.get(prior.fileKey);if(!source)throw new BackendError('RECEIPT_SOURCE_MISSING','The saved source is unavailable. Upload it again.',404);
 if(source.size>8*1024*1024)throw new BackendError('INVALID_RECEIPT_FILE','Use a receipt under 8 MB.');
 const bytes=new Uint8Array(await source.arrayBuffer());if(!bytes.length||bytes.length>8*1024*1024)throw new BackendError('INVALID_RECEIPT_FILE','Use a receipt under 8 MB.');
 // Capture the current source and acquire the optimistic transition before the one provider call.
 let draft=await repository.extracting(scope,prior.id,body.version);
 const result=await extractReceipt(env as unknown as Record<string,unknown>,{mime:prior.mime,bytes},planCurrency(state.plan),{acquire:()=>acquireAiLease(db(),scope.memberId,'receipt-extraction'),tracking:{database:db(),...scope}});
 draft=await repository.extracted(scope,draft.id,draft.version,result);
 await confirmReceiptBedrockReadback(db(),env as unknown as Record<string,unknown>,scope,draft,result.bedrockOperationId);
 const payer=planMembers(state).some(person=>person.id===access.user!.id)?access.user.id:'sam';
 return Response.json({draft,receipt:draftReceipt(draft,state,payer),reviewFields:receiptReviewFields(draft,planCurrency(state.plan)),note:draft.warnings.join(' · ')},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
