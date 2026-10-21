import {get,put,del,head,BlobNotFoundError} from '@vercel/blob';

type BlobApi=Pick<typeof import('@vercel/blob'),'get'|'put'|'del'|'head'>;
const managed=/^[a-f0-9]{64}\/(?:documents\/|uploads\/)?[a-f0-9-]{36}$/;
function key(value:string){if(!managed.test(value))throw Error('Invalid private object key.');return value;}

/** The app retains opaque object keys. Private Blob URLs and store tokens stay server-side. */
export function createBlobBucket(_database:D1Database,options:{token?:string;api?:BlobApi}={}):R2Bucket{
 const api=options.api??{get,put,del,head},auth=options.token?{token:options.token}:{};
 const metadata=(path:string,blob:{size:number;contentType?:string|null;etag?:string;uploadedAt?:Date})=>({key:path,size:blob.size,etag:blob.etag??'',httpEtag:blob.etag??'',uploaded:blob.uploadedAt??new Date(),version:blob.etag??'',checksums:{},httpMetadata:{contentType:blob.contentType??'application/octet-stream'},customMetadata:{},writeHttpMetadata(headers:Headers){headers.set('content-type',blob.contentType??'application/octet-stream');}});
 return {
  async get(path:string){
   key(path);const result=await api.get(path,{...auth,access:'private',useCache:false});if(!result)return null;
   if(result.statusCode!==200||!result.stream||result.blob.size===null)throw Error('Private object content is unavailable.');
   const body=result.stream;return {...metadata(path,{...result.blob,size:result.blob.size}),body,get bodyUsed(){return body.locked;},arrayBuffer:()=>new Response(body).arrayBuffer(),text:()=>new Response(body).text(),json:()=>new Response(body).json(),blob:()=>new Response(body).blob()};
  },
  async put(path:string,value:ReadableStream|ArrayBuffer|ArrayBufferView|string|Blob|null,settings?:R2PutOptions){
   key(path);if(value===null)throw Error('Choose private object content.');
   const mime=settings?.httpMetadata instanceof Headers?settings.httpMetadata.get('content-type'):settings?.httpMetadata?.contentType;
   const result=await api.put(path,value as Parameters<BlobApi['put']>[1],{...auth,access:'private',contentType:mime??'application/octet-stream',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60});
   // Metadata is only used by callers after a successful write; no Blob URL escapes this adapter.
   return metadata(path,{size:typeof value==='string'?new TextEncoder().encode(value).length:value instanceof Blob?value.size:'byteLength' in value?value.byteLength:0,contentType:result.contentType,etag:result.etag});
  },
  async head(path:string){try{key(path);return metadata(path,await api.head(path,auth));}catch(error){if(error instanceof BlobNotFoundError)return null;throw error;}},
  async delete(paths:string|string[]){for(const path of typeof paths==='string'?[paths]:paths){key(path);await api.del(path,auth);}},
 } as unknown as R2Bucket;
}
