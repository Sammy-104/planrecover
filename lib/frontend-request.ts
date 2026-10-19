/** Bound incoming JSON before allocating parsed structures or provider calls. */
export async function frontendJson(request:Request,maxBytes=131072,readMilliseconds=10000):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error('Send this request as JSON.');
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw Error('This request is too large.');
 const reader=request.body?.getReader();if(!reader)throw Error('A JSON request is required.');const chunks:Uint8Array[]=[];let size=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([(async()=>{for(;;){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>maxBytes)throw Error('This request is too large.');chunks.push(result.value);}})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('This request took too long. Try again.')),readMilliseconds);})]);}finally{if(timer)clearTimeout(timer);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let input:unknown;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('Send a valid JSON request.');}
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Send a JSON object.');return input as Record<string,unknown>;
}
