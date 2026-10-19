import {env} from 'cloudflare:workers';
import {db} from '@/lib/store';
import {BackendError} from '@/lib/backend-errors';
import {notificationText,receiveSesEvent} from '@/lib/ses-delivery-events';

export async function POST(request:Request){
 try{return Response.json(await receiveSesEvent(db(),env as unknown as Record<string,unknown>,await notificationText(request.body,32768)),{headers:{'Cache-Control':'no-store'}});}
 catch(error){const status=error instanceof BackendError?error.status:503;return Response.json({error:error instanceof BackendError?error.message:'SES event processing could not be completed.'},{status,headers:{'Cache-Control':'no-store',...(status===503?{'Retry-After':'30'}:{})}});}
}
