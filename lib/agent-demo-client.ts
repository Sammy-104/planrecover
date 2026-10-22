import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type DemoConnectionEvent={method:string;tool?:string;status:number};
type Options={fetch?:typeof fetch;observe?:(event:DemoConnectionEvent)=>void};
const requiredTools=['list_plans','get_plan','get_my_money','get_decisions'];
const requestOptions={timeout:15_000};

/** Browser-only MCP client. Observations contain method names and HTTP status, never arguments or results. */
export class AgentDemoClient {
  private client:Client|null=null;
  private connection:Promise<string[]>|null=null;
  private closed=false;
  private names=new Set<string>();

  constructor(private endpoint:URL,private options:Options={}) {}

  connect():Promise<string[]> {
    if(this.closed)return Promise.reject(new Error('This assistant connection is closed.'));
    if(this.connection)return this.connection;
    const client=new Client({name:'PlanRecover simulated Alexa+ client',version:'1.0.0'});
    this.client=client;
    const send=this.options.fetch??globalThis.fetch.bind(globalThis);
    const transport=new StreamableHTTPClientTransport(this.endpoint,{
      requestInit:{credentials:'same-origin'},
      fetch:async(input,init)=>{
        let message:{method?:string;params?:{name?:string}}={};
        if(typeof init?.body==='string'){try{message=JSON.parse(init.body);}catch{/* The SDK validates messages. */}}
        const response=await send(input,init);
        if(message.method)this.options.observe?.({method:message.method,tool:message.params?.name,status:response.status});
        if(response.status===401)throw new Error('Sign in to PlanRecover to use this assistant.');
        return response;
      },
      reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1},
    });
    this.connection=(async()=>{
      try {
        await client.connect(transport,requestOptions);
        const discovered=await client.listTools({},requestOptions);
        this.names=new Set(discovered.tools.map(tool=>tool.name));
        if(requiredTools.some(name=>!this.names.has(name)))throw new Error('The planning tools are unavailable. Try connecting again.');
        await client.readResource({uri:'planrecover://skills/planning'},requestOptions);
        if(this.closed)throw new Error('This assistant connection is closed.');
        return [...this.names];
      } catch(error) {
        this.connection=null;
        if(this.client===client)this.client=null;
        await client.close().catch(()=>{});
        throw error;
      }
    })();
    return this.connection;
  }

  async call(name:string,args:Record<string,unknown>):Promise<Record<string,any>> {
    await this.connect();
    if(this.closed||!this.client)throw new Error('This assistant connection is closed.');
    if(!this.names.has(name))throw new Error('This planning tool is unavailable.');
    const result=await this.client.callTool({name,arguments:args},undefined,requestOptions);
    if(result.isError){const parts=Array.isArray(result.content)?result.content:[];const message=parts.find((part:unknown)=>!!part&&typeof part==='object'&&'type'in part&&part.type==='text') as {text?:string}|undefined;throw new Error(message?.text??'This request could not be completed.');}
    if(!result.structuredContent||typeof result.structuredContent!=='object')throw new Error('The planning tool returned no saved result.');
    return result.structuredContent;
  }

  async close() {
    this.closed=true;
    await this.client?.close();
    this.client=null;
  }
}
