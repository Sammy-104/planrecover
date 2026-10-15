import { z } from 'zod';
import { BackendError } from './backend-errors.ts';
import { personalMoney, planReminders, type State } from './model.ts';
import { currencyDigits,planCurrency } from './money.ts';
import type { PlanRepository } from './plan-repository.ts';
import type { Identity } from './people.ts';
import { planningSkill } from './planrecover-skill.ts';
import {agentToolDefinitions,executeAgentTool,type AgentContext} from './agent-tools.ts';

type McpContext={identity:Identity;repository:PlanRepository;agentContext?:AgentContext};
const versions=['2025-11-25','2025-06-18','2025-03-26'];
const modernVersion='2026-07-28';
const serverInfo={name:'PlanRecover',version:'0.5.0'};
const capabilities={tools:{listChanged:false},resources:{subscribe:false,listChanged:false}};
const instructions='Use the planning Agent Skill resource. Data calls require a signed-in PlanRecover member. Read tools preserve saved data; preparation tools save review previews only. No tool approves costs or executes payments or refunds.';
const headers={'Cache-Control':'private, no-store'};
const empty=z.object({}).strict();
const planInput=z.object({planId:z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)}).strict();
const planSchema={type:'object',properties:{planId:{type:'string',minLength:1,maxLength:180}},required:['planId'],additionalProperties:false};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const tools=[
  {name:'list_plans',description:'List plans the signed-in person owns or has joined.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
  {name:'get_plan',description:'Read one accessible plan, its schedule, members and current approval status.',inputSchema:planSchema,annotations},
  {name:'get_my_money',description:'Read the signed-in person’s separate cost, contribution, balances and refund amounts for a plan.',inputSchema:planSchema,annotations},
  {name:'get_decisions',description:'Read the caller’s pending item, invoice and recovery approvals, documented reminders and saved notifications.',inputSchema:planSchema,annotations},
  ...agentToolDefinitions.map(tool=>({...tool,annotations:{readOnlyHint:['compare_recovery_options','get_change_status'].includes(tool.name),destructiveHint:false,idempotentHint:['compare_recovery_options','get_change_status'].includes(tool.name),openWorldHint:false}})),
];
const resource={uri:'planrecover://skills/planning',name:'planrecover-planning',description:'Agent Skill for answering PlanRecover questions.',mimeType:'text/markdown'};
const rpcSchema=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string().max(180),z.number().int().safe()]).optional(),method:z.string().max(100),params:z.record(z.unknown()).optional()}).strict();
function rpcResponse(id:string|number|null,result:unknown,status=200) {return Response.json({jsonrpc:'2.0',id,result},{status,headers});}
function rpcError(id:string|number|null,code:number,message:string,status=200,data?:unknown) {return Response.json({jsonrpc:'2.0',id,error:{code,message,...(data?{data}:{})}},{status,headers});}
function headerName(value:string|null) {
  if(value===null)return null;
  if(value.startsWith('=?base64?')&&value.endsWith('?=')) {
    try {return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.slice(9,-2)),c=>c.charCodeAt(0)));}
    catch {return null;}
  }
  return /^[\x20-\x7e]+$/.test(value)&&value.trim()===value?value:null;
}
function toolResult(value:unknown) {return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false};}

async function limitedBody(request:Request) {
  const reader=request.body?.getReader();
  if(!reader)throw new BackendError('INVALID_REQUEST','Provide a JSON-RPC request.');
  const decoder=new TextDecoder();let text='',length=0;
  for(;;) {const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;
    if(length>65536){await reader.cancel();throw new BackendError('REQUEST_TOO_LARGE','The MCP request is too large.',413);}
    text+=decoder.decode(chunk.value,{stream:true});}
  return text+decoder.decode();
}

function planView(state:State) {
  return {plan:state.plan,version:state.version,members:state.people??[],
    schedule:state.items.map(item=>({id:item.id,name:item.name,category:item.category,start:item.start,duration:item.duration,
      location:item.location,participants:item.participants,status:item.status,booking:item.booking,price:item.price,
      revision:item.revision,approved:item.approvals.length,required:(item.required??item.participants).length,
      source:item.source,policy:item.policy,expires:item.expires,deadline:item.deadline})),
    demo:state.plan.template==='algonquin'};
}

/** Stateless Streamable HTTP; each data call resolves fresh authenticated membership. */
export async function handlePlanMcp(request:Request,resolveContext:()=>Promise<McpContext>):Promise<Response> {
  let id:string|number|null=null;
  let modern=false;
  const rpc=(id:string|number|null,result:Record<string,unknown>,status=200)=>rpcResponse(id,modern?
    {...result,resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':serverInfo}}:result,status);
  try {
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return rpcError(null,-32000,'This origin is not allowed.',403);
    const protocol=request.headers.get('mcp-protocol-version');
    const accept=request.headers.get('accept')??'';
    if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return rpcError(null,-32600,'Accept application/json and text/event-stream.',406);
    if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))return rpcError(null,-32600,'Use application/json.',415);
    let input:unknown;
    try {input=JSON.parse(await limitedBody(request));}catch(error){if(error instanceof BackendError)throw error;return rpcError(null,-32700,'Invalid JSON.',400);}
    const parsed=rpcSchema.safeParse(input);
    if(!parsed.success)return rpcError(null,-32600,'Provide a single valid JSON-RPC message.',400);
    const message=parsed.data;id=message.id??null;
    const meta=message.params?._meta as Record<string,unknown>|undefined;
    modern=protocol===modernVersion||meta?.['io.modelcontextprotocol/protocolVersion']===modernVersion;
    if(protocol&&protocol!==modernVersion&&!versions.includes(protocol))
      return rpcError(id,-32022,'Unsupported MCP protocol version.',400,{supported:[modernVersion,...versions],requested:protocol});
    if(modern) {
      if(protocol!==modernVersion||meta?.['io.modelcontextprotocol/protocolVersion']!==modernVersion||request.headers.get('mcp-method')!==message.method)
        return rpcError(id,-32020,'Protocol and method headers must match the request metadata.',400);
      if(!z.record(z.unknown()).safeParse(meta?.['io.modelcontextprotocol/clientCapabilities']).success)
        return rpcError(id,-32602,'Declare client capabilities in request metadata.',400);
      const expectedName=message.method==='tools/call'?message.params?.name:message.method==='resources/read'?message.params?.uri:undefined;
      if(expectedName!==undefined&&headerName(request.headers.get('mcp-name'))!==expectedName)
        return rpcError(id,-32020,'The MCP name header must match the tool name or resource URI.',400);
    }
    if(message.id===undefined) {
      if(['notifications/initialized','notifications/cancelled'].includes(message.method))return new Response(null,{status:202,headers});
      return rpcError(null,-32600,'Unsupported notification.',400);
    }
    if(message.method==='initialize') {
      if(modern)return rpcError(id,-32601,'Modern clients use server/discover instead of initialize.',404);
      const params=z.object({protocolVersion:z.string(),capabilities:z.record(z.unknown()),clientInfo:z.object({name:z.string(),version:z.string()}).passthrough()}).passthrough().safeParse(message.params);
      if(!params.success)return rpcError(id,-32602,'Provide initialization parameters.');
      return rpc(id,{protocolVersion:versions.includes(params.data.protocolVersion)?params.data.protocolVersion:versions[0],
        capabilities,serverInfo,instructions});
    }
    if(message.method==='server/discover') {
      if(!modern)return rpcError(id,-32601,'Use modern request metadata for server discovery.');
      return rpc(id,{supportedVersions:[modernVersion],capabilities,instructions,ttlMs:0,cacheScope:'public'});
    }
    if(message.method==='ping')return rpc(id,{});
    if(message.method==='tools/list')return rpc(id,{tools});
    if(message.method==='resources/list')return rpc(id,{resources:[resource]});
    if(message.method==='resources/read') {
      if(message.params?.uri!==resource.uri)return rpcError(id,-32602,'Unknown resource.');
      return rpc(id,{contents:[{uri:resource.uri,mimeType:resource.mimeType,text:planningSkill}]});
    }
    if(message.method!=='tools/call')return rpcError(id,-32601,'Unknown MCP method.',modern?404:200);
    const call=z.object({name:z.string(),arguments:z.record(z.unknown()).optional(),_meta:z.record(z.unknown()).optional()}).strict().safeParse(message.params);
    if(!call.success)return rpcError(id,-32602,'Provide a tool name and arguments.');
    if(!tools.some(tool=>tool.name===call.data.name))return rpcError(id,-32602,'Unknown PlanRecover tool.');
    if(agentToolDefinitions.some(tool=>tool.name===call.data.name)){
      const context=await resolveContext();if(!context.agentContext)throw new BackendError('AGENT_UNAVAILABLE','Use the authenticated PlanRecover review workspace for proposals.',503);
      return rpc(id,toolResult(await executeAgentTool(context.agentContext,call.data.name,call.data.arguments??{})));
    }
    const argumentsInput=(call.data.name==='list_plans'?empty:planInput).safeParse(call.data.arguments??{});
    if(!argumentsInput.success)return rpcError(id,-32602,'Provide valid tool arguments.');
    const {identity,repository}=await resolveContext();
    if(call.data.name==='list_plans')return rpc(id,toolResult({plans:await repository.listPlans(identity.id)}));
    const {planId}=argumentsInput.data as {planId:string};
    const {state}=await repository.getPlan(planId,identity);
    if(call.data.name==='get_plan')return rpc(id,toolResult(planView(state)));
    if(call.data.name==='get_decisions')return rpc(id,toolResult({planId,currency:planCurrency(state.plan),decimalPlaces:currencyDigits(planCurrency(state.plan)),...await repository.getDecisionExtras(planId,identity),
      approvals:state.items.filter(item=>(item.required??item.participants).includes(identity.id)&&!item.approvals.includes(identity.id)&&item.status!=='cancelled')
        .map(item=>({itemId:item.id,name:item.name,revision:item.revision,share:item.shares[identity.id]??0,expires:item.expires})),
      proposals:state.proposals.filter(proposal=>proposal.required.includes(identity.id)&&!proposal.approved.includes(identity.id)&&proposal.status!=='executed')
        .map(proposal=>({id:proposal.id,title:proposal.title,revision:proposal.revision,status:proposal.status})),
      reminders:planReminders(state).filter(reminder=>!reminder.done)}));
    return rpc(id,toolResult({planId,currency:planCurrency(state.plan),decimalPlaces:currencyDigits(planCurrency(state.plan)),
      amounts:personalMoney(state,identity.id),privatePreferences:state.preferences[identity.id]??null,
      fundingAvailability:'Unverified. Pending refunds are not available cash.',demo:state.plan.template==='algonquin'}));
  }catch(error) {
    if(error instanceof BackendError&&[401,403,413].includes(error.status))return rpcError(id,-32000,error.message,error.status);
    if(error instanceof BackendError)return rpc(id,{content:[{type:'text',text:error.message}],isError:true});
    return rpcError(id,-32603,'PlanRecover could not complete this request.',500);
  }
}
