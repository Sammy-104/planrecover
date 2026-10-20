import type {ReactNode} from 'react';

/** Cloudflare/Sites keeps its existing gateway. Next aliases this module on Vercel. */
export default function RuntimeIdentity({children}:{children:ReactNode}){return <>{children}</>;}
export function RuntimeSignIn({returnTo}:{returnTo:string}){return <GatewayLink action="signin" returnTo={returnTo}/>;}
export function RuntimeSignUp({returnTo}:{returnTo:string}){return <GatewayLink action="signin" returnTo={returnTo}/>;}
export function RuntimeSignOut({returnTo}:{returnTo:string}){return <GatewayLink action="signout" returnTo={returnTo}/>;}
function GatewayLink({action,returnTo}:{action:'signin'|'signout';returnTo:string}){
 return <a className="btn primary" href={`/${action}-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`} target="_top">Continue to {action==='signin'?'sign in':'sign out'}</a>;
}
