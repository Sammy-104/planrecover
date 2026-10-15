import {workspaceAccess,apiError,db} from '@/lib/store';
import {ReceiptDraftRepository} from '@/lib/receipt-drafts';
import {BackendError} from '@/lib/backend-errors';
import {z} from 'zod';
export async function GET(request:Request){try{
 const access=await workspaceAccess(request);if(!access.user)throw new BackendError('AUTH_REQUIRED','Sign in to read receipt history.',401);
 const url=new URL(request.url),body=z.object({tripId:z.string().min(1).max(180),draftId:z.string().uuid(),before:z.coerce.number().int().nonnegative().optional()}).parse({tripId:url.searchParams.get('tripId'),draftId:url.searchParams.get('draftId'),before:url.searchParams.get('before')??undefined});
 if(access.share&&access.share.tripId!==body.tripId)throw new BackendError('RECEIPT_UNAVAILABLE','This receipt draft is unavailable.',404);
 return Response.json(await new ReceiptDraftRepository(db()).history({owner:access.id,planId:body.tripId,memberId:access.user.id},body.draftId,body.before),{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return apiError(error);}}
