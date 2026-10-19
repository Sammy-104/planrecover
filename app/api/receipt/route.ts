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
      if(!key.startsWith(`${await prefix(access.id)}/`))throw new BackendError('RECEIPT_ACCESS','Receipt unavailable.',403);
      if(access.share){
        const state=await loadAccess(access);
        if(!state.receipts.some(receipt=>receipt.fileKey===key)){
          const current=await context(request);
          await current.repository.byFile(current.scope,key);
        }
      }
      if(!env.BUCKET)throw Error('Receipt storage unavailable.');
      const file=await env.BUCKET.get(key);
      if(!file)return new Response('Not found',{status:404,headers:privateHeaders});
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
    const current=await context(request,true),form=await request.formData(),file=form.get('file');
    if(!(file instanceof File)||!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>8*1024*1024)
      throw new BackendError('INVALID_RECEIPT_FILE','Upload a PNG, JPEG, WebP or PDF receipt under 8 MB.');
    if(form.get('tripId')&&form.get('tripId')!==current.state.plan.id)
      throw new BackendError('PLAN_CHANGED','The active plan changed. Refresh before uploading receipts.',409);
    if(!env.BUCKET)throw Error('Receipt storage unavailable.');
    const bytes=new Uint8Array(await file.arrayBuffer()),key=`${await prefix(current.access.id)}/${crypto.randomUUID()}`,sourceHash=await sourceDigest(bytes);
    await db().prepare("INSERT INTO receipt_objects(file_key,owner,plan_id,status,created,source_sha256) VALUES (?,?,?,'staged',?,?)").bind(key,current.scope.owner,current.scope.planId,new Date().toISOString(),sourceHash).run();
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
    let draft;
    try {draft=await current.repository.create(current.scope,{fileKey:key,mime:file.type,size:file.size});}
    catch(error){try{await env.BUCKET.delete(key);}catch{/* Cleanup can be retried separately. */}throw error;}
    await db().prepare("UPDATE receipt_objects SET status='ready' WHERE file_key=? AND owner=? AND plan_id=? AND status='staged'").bind(key,current.scope.owner,current.scope.planId).run();
    // Save the source and durable draft before either model is invoked.
    draft=await current.repository.extracting(current.scope,draft.id,draft.version);
    const result=await extractReceipt(env as unknown as Record<string,unknown>,{mime:file.type,bytes},planCurrency(current.state.plan),{
      acquire:()=>acquireAiLease(db(),current.scope.memberId,'receipt-extraction'),
      tracking:{database:db(),...current.scope},
    });
    draft=await current.repository.extracted(current.scope,draft.id,draft.version,result);
    await confirmReceiptBedrockReadback(db(),env as unknown as Record<string,unknown>,current.scope,draft,result.bedrockOperationId);
    return Response.json({...current.response(draft),note:draft.warnings.join(' · ')},{headers:privateHeaders});
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
async function prefix(id: string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
async function sourceDigest(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes as BufferSource);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
