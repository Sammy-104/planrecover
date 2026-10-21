import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { workspaceAccess,loadAccess,checkOrigin,apiError,requireEdit,db } from '@/lib/store';
import { planCurrency } from '@/lib/money';
import { planMembers } from '@/lib/model';
import { BackendError } from '@/lib/backend-errors';
import { ReceiptDraftRepository,draftReceipt,receiptReviewFields,type ReceiptDraft } from '@/lib/receipt-drafts';
import { extractReceipt } from '@/lib/receipt-extraction';
import { acquireAiLease } from '@/lib/ai-usage';
import {confirmReceiptBedrockReadback} from '@/lib/receipt-bedrock-evidence';
import {consumePrivateUpload,privateUploadRuntime,type PrivateUploadPublication} from '@/lib/private-uploads';
import {invoiceJson} from '@/lib/plan-invoices';
import {authorizeReceiptSource} from '@/lib/receipt-source-access';
import {publishReceiptSource} from '@/lib/receipt-source-publication';

const privateHeaders={'Cache-Control':'private, no-store'};
const reviewRequest=z.object({
  draftId:z.string().uuid(),version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),receipt:z.unknown(),
  resolvedFields:z.array(z.string().max(100)).max(110),currency:z.string().regex(/^[A-Z]{3}$/),
}).strict();
async function context(request: Request, edit=false) {
  const access=await workspaceAccess(request),state=await loadAccess(access);
  if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to review your receipt drafts.',401);
  if(edit)requireEdit(access,state);
  const tripId=new URL(request.url).searchParams.get('tripId');
  if(tripId&&tripId!==state.plan.id)throw new BackendError('PLAN_CHANGED','The active plan changed. Refresh before reviewing receipts.',409);
  const scope={owner:access.id,planId:state.plan.id!,memberId:access.user.id};
  const repository=new ReceiptDraftRepository(db());
  const payer=planMembers(state).some(person=>person.id===access.user!.id)?access.user.id:'sam';
  const response=(draft: ReceiptDraft)=>({draft,receipt:draftReceipt(draft,state,payer),reviewFields:receiptReviewFields(draft,planCurrency(state.plan))});
  return {access,state,scope,repository,response};
}
export async function GET(request: Request) {
  try {
    const url=new URL(request.url),key=url.searchParams.get('key');
    if(key){
      const access=await workspaceAccess(request);
      const source=await authorizeReceiptSource(db(),access,key);
      if(!env.BUCKET)throw Error('Receipt storage unavailable.');
      const file=await env.BUCKET.get(key);
      if(!file)return new Response('Not found',{status:404,headers:privateHeaders});
      try{
        const fresh=await authorizeReceiptSource(db(),access,key);
        if(fresh.owner!==source.owner||fresh.planId!==source.planId)throw new BackendError('RECEIPT_UNAVAILABLE','This receipt source is unavailable or access changed.',404);
      }catch(error){try{await file.body.cancel();}catch{/* Already closed or a fixture body. */}throw error;}
      return new Response(file.body,{headers:{...privateHeaders,'Content-Type':file.httpMetadata?.contentType??'application/octet-stream','X-Content-Type-Options':'nosniff'}});
    }
    const current=await context(request),draftId=url.searchParams.get('draftId'),fileKey=url.searchParams.get('draftFileKey');
    if(draftId||fileKey){
      const draft=draftId?await current.repository.get(current.scope,draftId):await current.repository.byFile(current.scope,fileKey!);
      return Response.json(current.response(draft),{headers:privateHeaders});
    }
    const drafts=await current.repository.list(current.scope);
    return Response.json({drafts},{headers:privateHeaders});
  }catch(error){return apiError(error);}
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const current=await context(request,true);
    if(!env.BUCKET)throw Error('Receipt storage unavailable.');
    const direct=privateUploadRuntime()&&request.headers.get('content-type')?.startsWith('application/json');
    const publish=async(file:{bytes:Uint8Array;mime:string;publication?:PrivateUploadPublication})=>{
      const {bytes,mime}=file;
      let draft=await publishReceiptSource(db(),env.BUCKET!,current.repository,current.scope,file,saved=>({...current.response(saved),note:saved.warnings.join(' · ')}));
      // Save the source and durable draft before either model is invoked.
      draft=await current.repository.extracting(current.scope,draft.id,draft.version);
      const result=await extractReceipt(env as unknown as Record<string,unknown>,{mime,bytes},planCurrency(current.state.plan),{
        acquire:()=>acquireAiLease(db(),current.scope.memberId,'receipt-extraction'),tracking:{database:db(),...current.scope},
      });
      draft=await current.repository.extracted(current.scope,draft.id,draft.version,result);
      await confirmReceiptBedrockReadback(db(),env as unknown as Record<string,unknown>,current.scope,draft,result.bedrockOperationId);
      return {...current.response(draft),note:draft.warnings.join(' · ')};
    };
    if(direct){
      const body=z.object({tripId:z.string().min(1).max(180),uploadId:z.string().uuid()}).strict().parse(await invoiceJson(request,1000));
      if(body.tripId!==current.state.plan.id)throw new BackendError('PLAN_CHANGED','The active plan changed. Refresh before uploading receipts.',409);
      return Response.json(await consumePrivateUpload(db(),env.BUCKET,current.access.user!,body.tripId,'receipt',body.uploadId,publish,{resolve:async saved=>{const draft=await current.repository.get(current.scope,saved.draft.id);return {...current.response(draft),note:draft.warnings.join(' · ')};}}),{headers:privateHeaders});
    }
    const form=await request.formData(),file=form.get('file');
    if(!(file instanceof File)||!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>8*1024*1024)
      throw new BackendError('INVALID_RECEIPT_FILE','Upload a PNG, JPEG, WebP or PDF receipt under 8 MB.');
    if(form.get('tripId')&&form.get('tripId')!==current.state.plan.id)
      throw new BackendError('PLAN_CHANGED','The active plan changed. Refresh before uploading receipts.',409);
    return Response.json(await publish({bytes:new Uint8Array(await file.arrayBuffer()),mime:file.type}),{headers:privateHeaders});
  }catch(error){return apiError(error);}
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const current=await context(request,true),parsed=reviewRequest.safeParse(await request.json());
    if(!parsed.success)throw new BackendError('INVALID_RECEIPT_REVIEW','Provide the current receipt draft, reviewed values and resolved source fields.');
    const body=parsed.data;
    const draft=await current.repository.review(current.scope,body.draftId,body.version,current.state,body.receipt,body.resolvedFields,body.currency);
    return Response.json(current.response(draft),{headers:privateHeaders});
  }catch(error){return apiError(error);}
}
