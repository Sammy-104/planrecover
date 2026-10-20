'use client';
import {ClerkProvider,SignIn,SignUp,useAuth,useClerk} from '@clerk/nextjs';
import {useEffect,useRef,useState,type ReactNode} from 'react';

export default function RuntimeIdentity({children}:{children:ReactNode}){
 return <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">{children}</ClerkProvider>;
}
export function RuntimeSignIn({returnTo}:{returnTo:string}){
 return <SignIn routing="path" path="/sign-in" forceRedirectUrl={returnTo} signUpForceRedirectUrl={returnTo} signUpUrl={`/sign-up?return_to=${encodeURIComponent(returnTo)}`}/>;
}
export function RuntimeSignUp({returnTo}:{returnTo:string}){
 return <SignUp routing="path" path="/sign-up" forceRedirectUrl={returnTo} signInForceRedirectUrl={returnTo} signInUrl={`/sign-in?return_to=${encodeURIComponent(returnTo)}`}/>;
}
export function RuntimeSignOut({returnTo}:{returnTo:string}){
 const {signOut}=useClerk(),{isLoaded}=useAuth(),started=useRef(false),[failed,setFailed]=useState(false);
 async function leave(){setFailed(false);try{await signOut({redirectUrl:returnTo});}catch{setFailed(true);}}
 useEffect(()=>{if(isLoaded&&!started.current){started.current=true;void leave();}},[isLoaded]);
 return <div role="status">{failed?<><p>Sign out could not finish. Please try again.</p><button className="btn" onClick={()=>void leave()}>Try again</button></>:<p>Signing out…</p>}</div>;
}
