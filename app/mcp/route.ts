import { handlePlanMcp } from '@/lib/plan-mcp';
import { planApiContext } from '@/lib/plan-api';
import {db} from '@/lib/store';

export async function POST(request:Request) {
  return handlePlanMcp(request,async()=>{const context=await planApiContext(request,{readOnly:true});return {...context,agentContext:{database:db(),repository:context.repository,owner:context.access.id,identity:context.identity}};});
}
export function GET() {
  return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
}
export function DELETE() {return GET();}
