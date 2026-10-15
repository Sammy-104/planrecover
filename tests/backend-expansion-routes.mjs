import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId} from '../lib/people.ts';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('vite'))(createRequire(require.resolve('vite')).resolve('esbuild'));
const root=fileURLToPath(new URL('../',import.meta.url));mkdirSync(join(root,'build'),{recursive:true});const temp=mkdtempSync(join(root,'build','expansion-routes-'));
const database=createTestD1(),owner='expansion-route-owner',identity={id:await accountPersonId(owner),name:'Owner'},origin='https://planrecover.test';globalThis.expansionEnv={DB:database};
const routes={};let checks=0;
try{
 for(const [name,path]of Object.entries({agentClient:'app/api/agent-client/route.ts',changes:'app/api/plans/[planId]/changes/route.ts',proposals:'app/api/agent-proposals/route.ts',supplier:'app/api/plans/[planId]/supplier/route.ts',notifications:'app/api/plans/[planId]/me/notification-destinations/route.ts',location:'app/api/plans/[planId]/location/route.ts',workflow:'app/api/plans/[planId]/workflow/route.ts',operations:'app/api/plans/[planId]/operations/route.ts'})){
  const outfile=join(temp,name+'.mjs');await build({entryPoints:[resolve(root,path)],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.expansionEnv;',loader:'js'}));}}]});routes[name]=await import(pathToFileURL(outfile).href);
 }
 const repository=new PlanRepository(database),created=await repository.createPlan(owner,identity,{name:'Route checks',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:3000}),planId=created.state.plan.id,context={params:Promise.resolve({planId})};
 const request=(body,account=owner,requestOrigin=origin,method='POST')=>new Request(origin+'/api/fixture',{method,headers:{origin:requestOrigin,'Content-Type':'application/json',...(account?{'oai-authenticated-user-id':account}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 const count=()=>database.sqlite.prepare('SELECT COUNT(*) AS n FROM financial_events WHERE owner=? AND plan_id=?').get(owner,planId).n;
 for(const name of ['changes','supplier','location','workflow']){assert.equal((await routes[name].POST(request({},null),context)).status,401);assert.equal((await routes[name].POST(request({},owner,'https://outside.test'),context)).status,400);}assert.equal(count(),0);checks++;
 for(const name of ['changes','operations']){assert.equal((await routes[name].GET(request(undefined,'stranger',origin,'GET'),context)).status,404);}checks++;
 const before=(await repository.listPlans(identity.id)).length;
 const preview=await routes.proposals.POST(request({tool:'prepare_plan',input:{plan:{name:'Review before creation',destination:'Toronto',start:'2027-05-05',end:'2027-05-05',timezone:'America/Toronto',currency:'CAD',budget:2000}}})),value=await preview.json();assert.equal(preview.status,200,JSON.stringify(value));assert.equal((await repository.listPlans(identity.id)).length,before);
 assert.equal((await routes.proposals.POST(request({id:value.proposalId,confirm:true},'stranger'))).status,404);const applied=await routes.proposals.POST(request({id:value.proposalId,confirm:true}));assert.equal(applied.status,200);assert.equal((await repository.listPlans(identity.id)).length,before+1);assert.equal((await routes.proposals.POST(request({id:value.proposalId,confirm:true}))).status,200);assert.equal((await repository.listPlans(identity.id)).length,before+1);checks++;
 const destinations=await routes.notifications.PATCH(request({channel:'email',destination:'other@example.com',version:0,confirm:true}),context);assert.equal(destinations.status,400);assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM notification_destinations').get().n,0);assert.equal(count(),0);checks++;
 const status=await routes.operations.GET(request(undefined,owner,origin,'GET'),context),data=await status.json();assert.equal(status.status,200);assert.match(status.headers.get('cache-control'),/private, no-store/);assert.equal(data.configuration.notifications,false);assert.equal(data.configuration.supplier,false);assert.ok(!JSON.stringify(data).includes('fixture-token'));checks++;
 const rpc=(name,args,account=owner,requestOrigin=origin)=>new Request(origin+'/api/agent-client',{method:'POST',headers:{origin:requestOrigin,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',...(account?{'oai-authenticated-user-id':account}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
 const read=await routes.agentClient.POST(rpc('get_plan',{planId}));assert.equal(read.status,200);assert.equal((await read.json()).result.structuredContent.plan.id,planId);assert.equal((await routes.agentClient.POST(rpc('get_plan',{planId},null))).status,401);assert.equal((await routes.agentClient.POST(rpc('get_plan',{planId},owner,'https://outside.test'))).status,403);const outsider=await (await routes.agentClient.POST(rpc('get_plan',{planId},'stranger'))).json();assert.equal(outsider.result.isError,true);assert.equal(count(),0);checks++;
 console.log(`${checks} actual expansion-route checks passed: identity, origin, actor-scoped confirmation, idempotency, destination ownership and private service status. No network calls.`);
}finally{database.close();delete globalThis.expansionEnv;rmSync(temp,{recursive:true,force:true});}
