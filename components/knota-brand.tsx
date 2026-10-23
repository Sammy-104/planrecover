'use client';
import {useId} from 'react';
export function KnotaMark({size=36}:{size?:number}){
 const id=useId().replace(/:/g,'');
 return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false"><defs><mask id={id}><rect width="64" height="64" fill="white"/><path d="m24 24 16 16" stroke="black" strokeWidth="14" strokeLinecap="round"/></mask></defs><g mask={'url(#'+id+')'} stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"><path d="M32 14C16 2 2 18 14 32L32 50C44 62 60 46 48 32L32 14Z"/><path d="M32 14C48 2 62 18 50 32L32 50C20 62 4 46 16 32L32 14Z"/></g><path d="m24 24 16 16" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/></svg>;
}
export function KnotaBrand({motto=false}:{motto?:boolean}){return <span className="knota-brand"><span className="knota-logo"><KnotaMark/></span><span className="knota-wordmark">knota{motto&&<small>Connecting people, plans and details.</small>}</span></span>;}
