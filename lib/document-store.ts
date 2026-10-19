import {env} from 'cloudflare:workers';
import {db,type WorkspaceAccess} from './store';
import {TripDocumentService} from './trip-document-service';
/** Search uses the same membership, file visibility and lifecycle rules as downloads. */
export async function readableDocuments(access:WorkspaceAccess,tripId:string){
 if(!access.user||!env.BUCKET)return [];
 if(access.share&&access.share.tripId!==tripId)throw Error('This file does not belong to this shared plan.');
 return new TripDocumentService(db(),env.BUCKET).list(tripId,access.user);
}
