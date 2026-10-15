import {env} from 'cloudflare:workers';
import {apiError,db} from '@/lib/store';
import {planApiContext,privateHeaders} from '@/lib/plan-api';
import {BackendError} from '@/lib/backend-errors';
type Context={params:Promise<{planId:string}>};
export async function GET(request:Request,context:Context){try{const {repository,identity}=await planApiContext(request,{readOnly:true}),{planId}=await context.params,record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw new BackendError('FORBIDDEN','Only the plan owner can inspect service operations.',403);
 const settings=env as unknown as Record<string,unknown>,[operations,background]=await Promise.all([
  db().prepare('SELECT id,provider,kind,status,created,updated FROM adapter_operations WHERE owner=? AND plan_id=? ORDER BY updated DESC,id DESC LIMIT 100').bind(record.owner,planId).all(),
  db().prepare('SELECT status,last_started,last_completed,next_at FROM background_job_runs WHERE owner=?').bind(record.owner).first(),
 ]);
 return Response.json({operations:operations.results,background,configuration:{supplier:!!(settings.SUPPLIER_ORIGIN&&settings.SUPPLIER_TOKEN&&settings.SUPPLIER_MODE==='sandbox'),notifications:!!(settings.NOTIFICATION_ORIGIN&&settings.NOTIFICATION_TOKEN),amazonLocation:settings.AWS_ADAPTERS_ENABLED==='true'&&!!settings.AWS_ADAPTER_ACCESS_KEY_ID,approvalWorkflow:settings.AWS_ADAPTERS_ENABLED==='true'&&!!settings.STEP_FUNCTIONS_STATE_MACHINE_ARN,configurationIsNotLiveVerification:true}},{headers:privateHeaders});
}catch(e){return apiError(e);}}
