import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))(createRequire(require.resolve('vite')).resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});
const temporary=mkdtempSync(join(root,'build','local-preview-identity-')),database=createTestD1();
const previous={hosting:process.env.PLANRECOVER_HOSTING,vercel:process.env.VERCEL};
globalThis.localIdentityTestEnv={DB:database};
try{
 const outfile=join(temporary,'store.mjs');
 await build({entryPoints:[resolve(root,'lib/store.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'local-preview-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'binding',namespace:'local-identity'}));builder.onLoad({filter:/.*/,namespace:'local-identity'},()=>({contents:'export const env=globalThis.localIdentityTestEnv;',loader:'js'}));}}]});
 const {owner,workspaceAccess,tokenHash}=await import(pathToFileURL(outfile).href);
 const verifiedAccount='clerk:user_VerifiedFixture',identity={id:await accountPersonId(verifiedAccount),name:'Verified fixture'};
 const created=await new PlanRepository(database).createPlan(verifiedAccount,identity,{name:'Loopback identity fixture',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:0});
 const shareToken='d'.repeat(64);
 database.sqlite.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)').run(await tokenHash(shareToken),shareToken,verifiedAccount,created.state.plan.id,'viewer',new Date().toISOString(),new Date(Date.now()+60000).toISOString());
 function flags(hosting,vercel){if(hosting===undefined)delete process.env.PLANRECOVER_HOSTING;else process.env.PLANRECOVER_HOSTING=hosting;if(vercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=vercel;}
 for(const [hosting,vercel] of [['vercel',undefined],[undefined,'1'],['cloudflare','true'],[undefined,'0']]){
  flags(hosting,vercel);
  for(const hostname of ['localhost','127.0.0.1','terminal.local']){
   const url=`http://${hostname}:5173/api/workspace`,anonymous=new Request(url,{headers:{host:hostname,'x-forwarded-host':'localhost','x-forwarded-proto':'http'}});
   assert.throws(()=>owner(anonymous),/Sign in/);
   await assert.rejects(workspaceAccess(anonymous),/Sign in/);
   const shared=await workspaceAccess(new Request(url,{headers:{'x-trip-share':shareToken}}));
   assert.equal(shared.user,undefined,'A valid viewing link cannot turn a deployed localhost URL into a local user.');
   const signed=new Request(url,{headers:{'oai-authenticated-user-id':verifiedAccount,'oai-authenticated-user-email':'fixture@example.test'}});
   assert.equal(owner(signed),verifiedAccount);
   assert.equal((await workspaceAccess(signed)).user.id,identity.id,'Verified proxy identity remains usable.');
  }
 }
 flags(undefined,undefined);
 for(const hostname of ['localhost','127.0.0.1','terminal.local']){
  const local=new Request(`http://${hostname}:5173/api/workspace`);
  assert.equal(owner(local),'local-beta-testing');
  assert.equal((await workspaceAccess(local)).user.id,await accountPersonId('local-beta-testing'));
 }
 const publicRequest=new Request('https://planrecover.example/api/workspace');
 assert.throws(()=>owner(publicRequest),/Sign in/);await assert.rejects(workspaceAccess(publicRequest),/Sign in/);
 console.log('PASS Local preview identity is disabled by either Vercel flag for spoofed loopback URLs, including invitation requests; verified identities and default local previews are preserved.');
}finally{
 if(previous.hosting===undefined)delete process.env.PLANRECOVER_HOSTING;else process.env.PLANRECOVER_HOSTING=previous.hosting;
 if(previous.vercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous.vercel;
 delete globalThis.localIdentityTestEnv;database.close();rmSync(temporary,{recursive:true,force:true});
}
