'use client';
import {lazy,Suspense,useEffect,useState} from 'react';
import {rootWorkspaceDestination} from '@/lib/root-entry';

const OneStep=lazy(()=>import('./one-step/OneStep'));
function Opening(){return <main className="one-step"><section className="os-loading" role="status"><h1>Opening your plans…</h1></section></main>;}

/** Check private invitation fragments before mounting either workspace or loading saved plans. */
export default function RootEntry(){
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  const read=()=>{const destination=rootWorkspaceDestination(window.location.search,window.location.hash);if(destination){setReady(false);window.location.replace(destination);}else setReady(true);};
  read();window.addEventListener('hashchange',read);window.addEventListener('popstate',read);
  return()=>{window.removeEventListener('hashchange',read);window.removeEventListener('popstate',read);};
 },[]);
 return ready?<Suspense fallback={<Opening/>}><OneStep/></Suspense>:<Opening/>;
}
