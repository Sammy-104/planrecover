import type {OfflinePlan} from './plan-export.ts';
export function openOfflineDb(options:{factory?:Pick<IDBFactory,'open'>;timeoutMs?:number}={}){
 return new Promise<IDBDatabase>((resolve,reject)=>{
  const factory=options.factory??(typeof indexedDB==='undefined'?undefined:indexedDB);
  if(!factory){reject(Error('Device storage is unavailable. Download an offline copy instead.'));return;}
  let settled=false;
  const fail=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
  const timer=setTimeout(()=>fail(Error('Device storage did not respond. Download an offline copy instead.')),options.timeoutMs??5000);
  let request:IDBOpenDBRequest;
  try{request=factory.open('planrecover-offline',1);}catch(error){fail(error);return;}
  request.onblocked=()=>fail(Error('Another tab is blocking device storage. Close it or download a copy.'));
  request.onupgradeneeded=()=>{if(settled){request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains('plans'))request.result.createObjectStore('plans',{keyPath:'id'});};
  request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  request.onerror=()=>fail(request.error??Error('Device storage is unavailable.'));
 });
}
export async function storeOfflinePlan(plan:OfflinePlan){const db=await openOfflineDb();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('plans','readwrite');tx.objectStore('plans').put(plan);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('planrecover-offline-saved',{detail:plan.id}));}finally{db.close();}}
export async function readOfflinePlan(id:string){const db=await openOfflineDb();try{return await new Promise<OfflinePlan|undefined>((resolve,reject)=>{const request=db.transaction('plans','readonly').objectStore('plans').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}}
export async function enableOfflinePage(){if(!('serviceWorker' in navigator))throw Error('Offline page loading is unavailable in this browser. Download an offline copy instead.');const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Offline page loading could not be enabled. Download an offline copy instead.')),10000))]);return registration;}
export function downloadFile(content:string,name:string,mime:string){const url=URL.createObjectURL(new Blob([content],{type:mime})),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
