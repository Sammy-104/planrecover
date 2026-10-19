'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload,LoaderCircle,RotateCw,ScanLine,FileText} from 'lucide-react';
import {prepareReceiptImage,scanReceiptImage} from '@/lib/browser-receipt-scan';
import type {ReceiptDraft} from '@/lib/receipt-drafts';
type JsonFetch=(url:string,init?:RequestInit)=>Promise<any>;
export function ReceiptScanner({planId,draft,jsonFetch,onResult,onPreview,onBusyChange,sourceHeaders,disabled=false,cloudConnected=false}:{
 planId:string;draft:ReceiptDraft|null;jsonFetch:JsonFetch;onResult:(result:any)=>void;onPreview:(url:string,mime:string)=>void;onBusyChange:(busy:boolean)=>void;
 sourceHeaders:HeadersInit;disabled?:boolean;cloudConnected?:boolean;
}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[text,setText]=useState(''),[paste,setPaste]=useState(false),[rotation,setRotation]=useState(0);
 const input=useRef<HTMLInputElement>(null),life=useRef<AbortController|null>(null),preview=useRef(''),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;life.current?.abort();if(preview.current)URL.revokeObjectURL(preview.current);};},[]);
 function showPreview(blob:Blob){if(preview.current)URL.revokeObjectURL(preview.current);preview.current=URL.createObjectURL(blob);onPreview(preview.current,blob.type);}
 function progress(message:string){if(mounted.current)setStatus(message);}
 function start(){life.current?.abort();const controller=new AbortController();life.current=controller;setBusy(true);onBusyChange(true);setError('');return controller;}
 function finish(){if(mounted.current){setBusy(false);onBusyChange(false);}}
 async function saveText(content:string,current:ReceiptDraft,confidence?:number,source:'device'|'pasted'='device'){
  const result=await jsonFetch('/api/receipt/scan',{method:'POST',headers:{'Content-Type':'application/json'},signal:life.current?.signal,
   body:JSON.stringify({tripId:planId,draftId:current.id,version:current.version,text:content,confidence,source})});
  if(!mounted.current)return;onResult(result);progress(result.note);return result;
 }
 async function recognize(image:Blob,current:ReceiptDraft,controller:AbortController,turn=0){
  const result=await scanReceiptImage(image,progress,{signal:controller.signal,rotation:turn});
  if(!result.text.trim())throw Error('No readable text was found. Try a brighter, straight-on photo or paste the receipt text.');
  if(mounted.current)setText(result.text);
  await saveText(result.text,current,result.confidence);
 }
 async function upload(file:File){
  if(disabled||busy)return;const controller=start();setRotation(0);progress('Preparing your receipt…');showPreview(file);
  try{
   if(file.size>25*1024*1024)throw Error('Crop this large photo to the receipt and try again.');
   const pdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
   if(pdf&&file.size>8*1024*1024)throw Error('Use a PDF under 8 MB or upload a photo of the receipt.');
   const image=pdf?file:await prepareReceiptImage(file);if(controller.signal.aborted)return;
   if(!pdf)showPreview(image);
   progress(cloudConnected?'Saving your source and checking the receipt…':'Saving your receipt source…');
   const form=new FormData();form.set('file',image,pdf?'receipt.pdf':'receipt.jpg');form.set('tripId',planId);
   const result=await jsonFetch('/api/receipt',{method:'POST',body:form,signal:controller.signal});
   if(!mounted.current)return;onResult(result);
   if(pdf){progress(result.draft.sourceFacts?.items?.length?`PDF read: ${result.draft.sourceFacts.items.length} ${result.draft.sourceFacts.items.length===1?'item':'items'} added. Review every amount against the source.`:result.note||'PDF saved. Review it manually or paste its receipt text below.');return;}
   if(result.draft.sourceFacts?.items?.length){progress(`${result.draft.sourceFacts.items.length} items added. Review the amounts and who had each item.`);return;}
   await recognize(image,result.draft,controller);
  }catch(error){if(!controller.signal.aborted&&mounted.current){setError((error as Error).message);setStatus('Your saved uploads remain available below.');}}
  finally{finish();if(input.current)input.current.value='';}
 }
 async function scanSaved(turn=rotation){
  if(!draft||busy||disabled)return;const controller=start();
  try{progress('Opening your saved photo…');const response=await fetch(`/api/receipt?key=${encodeURIComponent(draft.fileKey)}`,{headers:sourceHeaders,signal:controller.signal});
   if(!response.ok)throw Error('The saved photo could not be opened. Upload it again.');const image=await response.blob();
   await recognize(image,draft,controller,turn);
  }catch(error){if(!controller.signal.aborted&&mounted.current)setError((error as Error).message);}finally{finish();}
 }
 async function retryConnected(){
  if(!draft||busy||disabled)return;const controller=start();setText('');progress('Retrying connected AI. Earlier revisions will be retained…');
  try{const result=await jsonFetch('/api/receipt/retry',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({tripId:planId,draftId:draft.id,version:draft.version})});if(mounted.current){onResult(result);progress(result.note);}}
  catch(error){if(!controller.signal.aborted&&mounted.current)setError((error as Error).message);}finally{finish();}
 }
 return <div className="receipt-scanner"><input type="file" ref={input} accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);}}/>
  <button className="btn primary full" disabled={disabled||busy} onClick={()=>input.current?.click()}>{busy?<LoaderCircle size={17} className="spin"/>:<Upload size={17}/>} {busy?'Scanning…':'Upload & scan receipt'}</button>
  {draft?.mime.startsWith('image/')&&draft.status!=='reviewed'&&<div className="receipt-scan-actions"><button className="btn" disabled={busy||disabled} onClick={()=>scanSaved()}><ScanLine size={15}/>Scan again</button><button className="btn" disabled={busy||disabled} onClick={()=>{const next=(rotation+90)%360;setRotation(next);void scanSaved(next);}}><RotateCw size={15}/>Rotate & scan</button></div>}
  {draft&&draft.status!=='reviewed'&&cloudConnected&&<button className="btn full" disabled={busy||disabled} onClick={()=>void retryConnected()}>Retry connected AI</button>}
  {status&&<p className="scan-status" role="status">{status}</p>}{error&&<p className="notice warning" role="alert">{error}</p>}
  <p className="source-footnote">Photos can be read on your device without an AI account. A straight, well-lit photo works best. Readable items appear automatically as a draft.</p>
  {draft&&draft.status!=='reviewed'&&<><button className="text-button" disabled={disabled||busy} onClick={()=>setPaste(value=>!value)}><FileText size={15}/>Paste receipt text instead</button>{paste&&<div className="receipt-paste"><label className="field"><span>Receipt text, including item prices and totals</span><textarea rows={6} maxLength={32000} value={text} onChange={event=>setText(event.target.value)} placeholder={'STORE NAME\nItem one 12.00\nTax 1.56\nTOTAL CAD 13.56'}/></label><button className="btn" disabled={busy||disabled||!text.trim()} onClick={async()=>{const controller=start();try{await saveText(text,draft,undefined,'pasted');setPaste(false);}catch(error){if(!controller.signal.aborted)setError((error as Error).message);}finally{finish();}}}>Fill items from text</button></div>}</>}
 </div>;
}
