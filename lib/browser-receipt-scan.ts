'use client';
import {receiptPaperBounds} from './receipt-image';
import {parseReceiptText} from './receipt-ocr';
type OcrWorker={recognize:(image:Blob)=>Promise<{data:{text:string;confidence:number}}> ;setParameters:(options:Record<string,string>)=>Promise<unknown>;terminate:()=>Promise<unknown>};
type OcrEngine={createWorker:(language:string,oem:number,options:Record<string,unknown>)=>Promise<OcrWorker>};
declare global{interface Window{Tesseract?:OcrEngine}}
let engine:Promise<OcrEngine>|undefined;
async function loadEngine(){
 if(window.Tesseract)return window.Tesseract;
 engine??=new Promise<OcrEngine>((resolve,reject)=>{const script=document.createElement('script');script.src='/ocr/tesseract.min.js';script.async=true;
  script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(Error('Receipt reader could not start.'));
  script.onerror=()=>reject(Error('Receipt reader could not load. Please try again.'));document.head.appendChild(script);});
 try{return await engine;}catch(error){engine=undefined;throw error;}
}
/** Local preprocessing also makes large phone photos suitable for connected vision models. */
export async function prepareReceiptImage(file:Blob,rotation=0,forOcr=false):Promise<Blob>{
 const bitmap=await createImageBitmap(file);try{
  if(bitmap.width*bitmap.height>60_000_000)throw Error('This photo is very large. Crop the receipt and try again.');
  const scale=Math.min(2,3200/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),turn=Math.abs(rotation%180)===90;
  const canvas=document.createElement('canvas');canvas.width=turn?h:w;canvas.height=turn?w:h;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('This browser cannot prepare the receipt image.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);
  ctx.drawImage(bitmap,-w/2,-h/2,w,h);
  if(forOcr){
   const sample=document.createElement('canvas');sample.width=Math.round(canvas.width*320/Math.max(canvas.width,canvas.height));sample.height=Math.round(canvas.height*320/Math.max(canvas.width,canvas.height));
   const sc=sample.getContext('2d')!;sc.drawImage(canvas,0,0,sample.width,sample.height);const bounds=receiptPaperBounds(sc.getImageData(0,0,sample.width,sample.height).data,sample.width,sample.height);
   const crop=document.createElement('canvas'),factor=Math.min(3,3200/Math.max(bounds.width*canvas.width/sample.width,bounds.height*canvas.height/sample.height));
   crop.width=Math.round(bounds.width*canvas.width/sample.width*factor);crop.height=Math.round(bounds.height*canvas.height/sample.height*factor);
   const cc=crop.getContext('2d')!;cc.drawImage(canvas,bounds.x*canvas.width/sample.width,bounds.y*canvas.height/sample.height,bounds.width*canvas.width/sample.width,bounds.height*canvas.height/sample.height,0,0,crop.width,crop.height);
   const pixels=cc.getImageData(0,0,crop.width,crop.height),histogram=new Uint32Array(256);
   for(let i=0;i<pixels.data.length;i+=4){const gray=Math.round(pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;histogram[gray]++;}
   const count=crop.width*crop.height;let low=0,high=255,seen=0;
   for(let i=0;i<256;i++){seen+=histogram[i];if(seen>=count*.01){low=i;break;}}seen=0;
   for(let i=255;i>=0;i--){seen+=histogram[i];if(seen>=count*.01){high=i;break;}}
   for(let i=0;i<pixels.data.length;i+=4){const value=(pixels.data[i]-low)*255/Math.max(1,high-low)>170?255:0;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;}
   cc.putImageData(pixels,0,0);
   return await new Promise<Blob>((resolve,reject)=>crop.toBlob(blob=>blob?resolve(blob):reject(Error('This image could not be read.')),'image/png'));
  }
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('This image could not be read.')),'image/jpeg',.92));
 }finally{bitmap.close();}
}
export async function scanReceiptImage(file:Blob,progress:(message:string)=>void,options:{rotation?:number;signal?:AbortSignal}={}){
 const abort=()=>{throw Error('Receipt scanning was cancelled.');};if(options.signal?.aborted)abort();
 progress('Preparing your photo…');const image=await prepareReceiptImage(file,options.rotation??0),api=await loadEngine();
 if(options.signal?.aborted)abort();let worker:OcrWorker|undefined,stopped=false;
 let rejectDeadline:(reason:Error)=>void=()=>{};
 const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
 const stop=()=>{stopped=true;rejectDeadline(Error(options.signal?.aborted?'Receipt scanning was cancelled.':'Scanning took too long. Try a smaller photo or paste the text.'));if(worker)void worker.terminate().catch(()=>{});};options.signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(stop,90_000);
 try{
  const operation=(async()=>{
  progress('Starting the receipt reader…');
  worker=await api.createWorker('eng',1,{workerPath:new URL('/ocr/worker.min.js',location.origin).href,
   corePath:new URL('/ocr/core',location.origin).href,langPath:new URL('/ocr/lang',location.origin).href,
   workerBlobURL:false,cacheMethod:'write',logger:(entry:{status:string;progress:number})=>{if(!stopped&&entry.status==='recognizing text')progress(`Reading your receipt… ${Math.round(entry.progress*100)}%`);}});
  if(stopped){await worker.terminate().catch(()=>{});throw Error('Receipt scanning was cancelled.');}
  await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1',user_defined_dpi:'300'});
  let result=await worker.recognize(image);if(stopped)abort();
  if(result.data.confidence<78||!parseReceiptText(result.data.text).items.length){
   progress('Checking faint lines and small print…');const enhanced=await prepareReceiptImage(file,options.rotation??0,true);if(stopped)abort();
   const alternate=await worker.recognize(enhanced);if(stopped)abort();
   const score=(text:string)=>{const facts=parseReceiptText(text),sum=facts.items.reduce((total,item)=>total+(item.amountCents??0),0)+(facts.taxIncluded?0:facts.taxCents??0)+(facts.tipCents??0)-(facts.discountCents??0);
    return facts.items.length*100+(facts.totalCents!==null&&facts.totalCents===sum?20:0);};
   if(score(alternate.data.text)>=score(result.data.text))result=alternate;
  }
  return {text:result.data.text.slice(0,32_000),confidence:result.data.confidence};})();
  return await Promise.race([operation,deadline]);
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);if(worker)await worker.terminate().catch(()=>{});}
}
