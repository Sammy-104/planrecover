// Build template: copied to the ignored root proxy.ts for the Vercel Next build.
import {clerkClient,clerkMiddleware} from '@clerk/nextjs/server';
import {NextResponse} from 'next/server';
import type {NextFetchEvent,NextRequest} from 'next/server';
import {clerkAuthorizedParties,legacyAuthDestination,profileIdentityCache,stripIdentityHeaders,verifiedRequestHeaders} from '@/platform/vercel/identity';

const authorizedParties=clerkAuthorizedParties(process.env);
const loadIdentity=profileIdentityCache(async userId=>(await clerkClient()).users.getUser(userId));
const withClerk=clerkMiddleware(async (auth,request)=>{
 const clean=stripIdentityHeaders(request.headers);
 // Auth and payment callback routes remain reachable; each data route enforces its own permissions.
 const legacy=legacyAuthDestination(request.nextUrl);
 if(legacy){
  const origin=request.headers.get('origin');
  if((request.nextUrl.pathname==='/signout-with-chatgpt')&&((origin&&origin!==request.nextUrl.origin)||request.headers.get('sec-fetch-site')==='cross-site'))return new NextResponse('Open sign out from PlanRecover.',{status:403,headers:{'Cache-Control':'private, no-store'}});
  const response=NextResponse.redirect(legacy,303);response.headers.set('Cache-Control','private, no-store');return response;
 }
 if(request.nextUrl.pathname==='/sign-out'&&request.headers.get('sec-fetch-site')==='cross-site')return new NextResponse('Open sign out from PlanRecover.',{status:403,headers:{'Cache-Control':'private, no-store'}});
 let userId:string|null=null;
 try{const session=await auth();if(authorizedParties.length&&session.userId&&session.sessionId)userId=session.userId;}catch{/* Invalid or unconfigured sessions stay anonymous. */}
 const headers=await verifiedRequestHeaders(clean,userId,loadIdentity);
 const response=NextResponse.next({request:{headers}});
 response.headers.set('Cache-Control','private, no-store');
 response.headers.append('Vary','Cookie');
 return response;
},{authorizedParties:authorizedParties.length?authorizedParties:['https://unconfigured.planrecover.invalid']});

export default function proxy(request:NextRequest,event:NextFetchEvent){
 // These routes authenticate provider/service signatures themselves. Clerk must
 // not interpret a runner's Bearer credential as an application session.
 if(request.nextUrl.pathname==='/api/jobs/scheduled'||request.nextUrl.pathname.startsWith('/api/webhooks/')){
  return NextResponse.next({request:{headers:stripIdentityHeaders(request.headers)}});
 }
 return withClerk(request,event);
}

export const config={matcher:[
 '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
 '/(api|trpc)(.*)',
 '/__clerk/(.*)',
]};
