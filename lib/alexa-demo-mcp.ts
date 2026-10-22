import {alternatives,people,runTool,toolNames} from './alexa-demo.ts';
const versions=['2025-11-25','2026-07-28'];
const contextSchema={type:'object',additionalProperties:false,properties:{scenario:{type:'string',enum:['rain','cancelled','late']},choice:{type:'string',enum:alternatives.map(o=>o.id)},approvals:{type:'array',uniqueItems:true,maxItems:4,items:{type:'string',enum:people.map(p=>p.id)}},applied:{type:'boolean'},cashLimit:{type:'integer',minimum:0,maximum:1000000}},required:['scenario','approvals','applied','cashLimit']};
export const tools=toolNames.map(name=>({name,title:name.replaceAll('_',' '),description:'Operate on Knota’s public fictional four-person NYC sample only. No personal plan, booking, payment or refund is changed.',inputSchema:{type:'object',additionalProperties:false,properties:{context:contextSchema,...(name==='report_trip_disruption'?{scenario:{type:'string',enum:['rain','cancelled','late']}}:{}),...(name==='preview_recovery'?{optionId:{type:'string',enum:alternatives.map(o=>o.id)}}:{}),...(name==='apply_reviewed_recovery'?{confirmed:{type:'boolean',const:true},reviewToken:{type:'string',maxLength:200}}:{})},required:name==='report_trip_disruption'?['scenario']:name==='preview_recovery'?['optionId']:name==='apply_reviewed_recovery'?['context','confirmed','reviewToken']:[]},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
export function reply(message:{id:string|number;method:string;params?:Record<string,unknown>}){
 const result=(value:unknown)=>({jsonrpc:'2.0',id:message.id,result:value});
 const error=(code:number,text:string)=>({jsonrpc:'2.0',id:message.id,error:{code,message:text}});
 if(message.method==='initialize')return result({protocolVersion:versions.includes(String(message.params?.protocolVersion))?message.params?.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'knota-sample-trip-recovery',title:'Knota · Sample Trip Recovery',version:'2.0.0'},instructions:'Alexa+ web experience simulation. All tools use a fictional public sample, with simulated reviews. No account link, supplier action, real booking, payment or refund. Never send personal data.'});
 if(message.method==='server/discover')return result({supportedVersions:versions,capabilities:{tools:{}}});
 if(message.method==='ping')return result({});
 if(message.method==='tools/list')return message.params?.cursor?error(-32602,'No additional tools.'):result({tools});
 if(message.method!=='tools/call')return error(-32601,'Method not found.');
 const name=message.params?.name;if(typeof name!=='string'||!toolNames.includes(name as typeof toolNames[number]))return error(-32602,'Unknown tool.');
 try{const value=runTool(name,message.params?.arguments??{});return result({isError:false,structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]});}catch(e){return result({isError:true,content:[{type:'text',text:(e as Error).message}]});}
}
export async function handleDemoMcp(request:Request){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&origin!=='https://chatgpt.com')return new Response('Origin not allowed.',{status:403,headers});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});
 const version=request.headers.get('mcp-protocol-version');if(version&&!versions.includes(version))return new Response('Unsupported MCP protocol version.',{status:400,headers});
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return new Response('Use application/json.',{status:415,headers});
 const accept=request.headers.get('accept');if(accept&&!/application\/json|text\/event-stream|\*\/\*/i.test(accept))return new Response('Accept application/json or text/event-stream.',{status:406,headers});
 if(Number(request.headers.get('content-length')??0)>16384)return new Response('Request too large.',{status:413,headers});
 const reader=request.body?.getReader();if(!reader)return new Response('JSON body required.',{status:400,headers});
 let text='',size=0;const decoder=new TextDecoder();
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return new Response('Request too large.',{status:413,headers});}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{return new Response('Invalid body.',{status:400,headers});}
 let m:any;try{m=JSON.parse(text);}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error.'}},{status:400,headers});}
 if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string'||m.params!==undefined&&(!m.params||typeof m.params!=='object'||Array.isArray(m.params)))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request.'}},{status:400,headers});
 if(m.id===undefined&&m.method.startsWith('notifications/'))return new Response(null,{status:202,headers});
 if(typeof m.id!=='string'&&(typeof m.id!=='number'||!Number.isFinite(m.id)))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'A request id is required.'}},{status:400,headers});
 return Response.json(reply(m),{headers});
}
