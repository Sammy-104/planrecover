/** Bounded chunks let a verified byte export use a streaming Function response. */
export function byteStream(bytes:Uint8Array){
 let offset=0;
 return new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return;}const end=Math.min(offset+64*1024,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}});
}
