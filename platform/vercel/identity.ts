export type VerifiedIdentity = {id:string;email:string;displayName:string};
export type ClerkProfile = {
 id:string;primaryEmailAddressId:string|null;
 emailAddresses:{id:string;emailAddress:string;verification?:{status:string}|null}[];
 firstName?:string|null;lastName?:string|null;username?:string|null;banned?:boolean;locked?:boolean;
};

/** The legacy names are internal transport only; never trust incoming values. */
export function stripIdentityHeaders(input:Headers){
 const headers=new Headers(input);
 for(const name of [...headers.keys()])if(name.toLowerCase().startsWith('oai-authenticated-user-'))headers.delete(name);
 return headers;
}

export function verifiedProfileIdentity(userId:string,profile:ClerkProfile):VerifiedIdentity|null{
 if(!/^user_[A-Za-z0-9]+$/.test(userId)||profile.id!==userId||profile.banned||profile.locked)return null;
 const primary=profile.emailAddresses.find(email=>email.id===profile.primaryEmailAddressId);
 if(!primary||primary.verification?.status!=='verified'||!primary.emailAddress||primary.emailAddress.length>254||/[\s\x00-\x1f\x7f]/.test(primary.emailAddress)||!primary.emailAddress.includes('@'))return null;
 const displayName=[profile.firstName,profile.lastName].filter(Boolean).join(' ').trim()||profile.username||primary.emailAddress;
 return {id:'clerk:'+userId,email:primary.emailAddress,displayName:displayName.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)};
}

/** Only a valid session's profile loader can supply identity to the app. */
export async function verifiedRequestHeaders(input:Headers,userId:string|null,load:(id:string)=>Promise<VerifiedIdentity|null>){
 const headers=stripIdentityHeaders(input);
 if(!userId)return headers;
 let identity:VerifiedIdentity|null=null;
 try{identity=await load(userId);}catch{/* Provider failure must leave the request anonymous. */}
 if(!identity||identity.id!=='clerk:'+userId)return headers;
 headers.set('oai-authenticated-user-id',identity.id);
 headers.set('oai-authenticated-user-email',identity.email);
 headers.set('oai-authenticated-user-full-name',encodeURIComponent(identity.displayName));
 headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
 return headers;
}

/** Small, short-lived profile cache. Session authentication still runs per request. */
export function profileIdentityCache(load:(id:string)=>Promise<ClerkProfile>,options:{now?:()=>number;ttlMs?:number;maxEntries?:number;timeoutMs?:number}={}){
 const now=options.now??Date.now,ttl=Math.min(30_000,Math.max(0,options.ttlMs??30_000)),max=Math.min(128,Math.max(1,options.maxEntries??128)),timeoutMs=Math.min(5000,Math.max(1,options.timeoutMs??5000));
 const cache=new Map<string,{until:number;identity:VerifiedIdentity}>(),pending=new Map<string,Promise<VerifiedIdentity|null>>();
 return async (id:string):Promise<VerifiedIdentity|null>=>{
  const hit=cache.get(id);if(hit&&hit.until>now())return hit.identity;cache.delete(id);
  const existing=pending.get(id);if(existing)return existing;
  let timer:ReturnType<typeof setTimeout>;
  const task=(async()=>{
   try{
    const profile=await Promise.race([load(id),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Identity lookup timed out.')),timeoutMs);})]);
    const identity=verifiedProfileIdentity(id,profile);
    if(identity){for(const [key,value] of cache)if(value.until<=now())cache.delete(key);while(cache.size>=max)cache.delete(cache.keys().next().value!);cache.set(id,{until:now()+ttl,identity});}
    return identity;
   }catch{return null;}finally{clearTimeout(timer!);}
  })();
  while(pending.size>=max)pending.delete(pending.keys().next().value!);pending.set(id,task);
  void task.finally(()=>{if(pending.get(id)===task)pending.delete(id);});return task;
 };
}

/** Authentication return destinations always stay on this application. */
export function safeReturnTo(value:unknown):string{
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\x00-\x1f\x7f\\]/.test(value))return '/';
 let decoded:string,url:URL;
 try{decoded=decodeURIComponent(value);url=new URL(value,'https://planrecover.invalid');}catch{return '/';}
 const reserved=/^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback|sign-in|sign-up|sign-out)(?:\/|\?|#|$)/i;
 if(decoded.startsWith('//')||/[\x00-\x1f\x7f\\]/.test(decoded)||url.origin!=='https://planrecover.invalid'||reserved.test(decoded)||reserved.test(decodeURIComponent(url.pathname)))return '/';
 return url.pathname+url.search+url.hash;
}

export function legacyAuthDestination(input:URL):URL|null{
 const path=input.pathname==='/signin-with-chatgpt'?'/sign-in':input.pathname==='/signout-with-chatgpt'?'/sign-out':null;
 if(!path)return null;
 const target=new URL(path,input.origin);target.searchParams.set('return_to',safeReturnTo(input.searchParams.get('return_to')));return target;
}

/** Exact configured deployment origins only; never derive trust from request headers. */
export function clerkAuthorizedParties(env:Record<string,string|undefined>):string[]{
 const local=env.NODE_ENV!=='production'&&!['preview','production'].includes(env.VERCEL_ENV??''),origins=new Set<string>();
 function add(value:string|undefined,hostname=false){
  if(!value)return;
  try{
   const url=new URL(hostname?`https://${value}`:value);
   if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.hostname.includes('*'))return;
   if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return;
   origins.add(url.origin);
  }catch{/* Invalid configuration is ignored; empty configuration fails closed. */}
 }
 for(const configured of (env.CLERK_AUTHORIZED_PARTIES??'').split(','))add(configured.trim());
 add(env.VERCEL_URL,true);add(env.VERCEL_BRANCH_URL,true);
 if(env.VERCEL_ENV==='production')add(env.VERCEL_PROJECT_PRODUCTION_URL,true);
 if(local){add('http://localhost:3000');add('http://127.0.0.1:3000');}
 return [...origins];
}
