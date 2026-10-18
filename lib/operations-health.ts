type Background={status:string;last_started:string|null;last_completed:string|null;next_at:number;lease_until?:number}|null;
export function backgroundHealth(background:Background,now=Date.now()){
 const alerts:{code:string;message:string;action:string}[]=[];
 if(!background?.last_completed||!Number.isFinite(Date.parse(background.last_completed)))alerts.push({code:'NO_COMPLETED_RUN',message:'No successful background check is recorded.',action:'Run a manual check, then verify an unattended scheduled tick.'});
 else if(now-Date.parse(background.last_completed)>90*60000)alerts.push({code:'BACKGROUND_OVERDUE',message:'The last successful background check is more than 90 minutes old.',action:'Inspect the existing schedule and service access; run a check after resolving the failure.'});
 if(background?.status==='retry')alerts.push({code:'BACKGROUND_RETRY',message:'The last background attempt needs another try.',action:'Check service configuration and provider status before retrying.'});
 if(background?.status==='running'&&background.lease_until!==undefined&&background.lease_until<now)alerts.push({code:'BACKGROUND_STALLED',message:'A background run stopped before releasing its lease.',action:'A later bounded runner may reclaim the lease. Inspect its result; do not erase financial records.'});
 return {status:alerts.length?'attention-required':'healthy',alerts,overdueThresholdMinutes:90};
}
export async function planOperationsQueue(database:D1Database,owner:string,planId:string){
 const [payments,invoices,adapters,reminders]=await Promise.all([
  database.prepare("SELECT id,kind,status,provider_id FROM provider_operations WHERE owner=? AND json_extract(payload,'$.planrecoverTripId')=? AND status IN ('creating','creation-uncertain','capture-uncertain','refund-pending','manual-review') ORDER BY id LIMIT 50").bind(owner,planId).all(),
  database.prepare("SELECT id,COALESCE(lifecycle_status,status) status FROM plan_invoices WHERE owner=? AND plan_id=? AND COALESCE(lifecycle_status,status) IN ('needs-review','creating','sending') ORDER BY updated LIMIT 50").bind(owner,planId).all(),
  database.prepare("SELECT id,provider,kind,status FROM adapter_operations WHERE owner=? AND plan_id=? AND status IN ('uncertain','failed','manual-review') ORDER BY updated LIMIT 50").bind(owner,planId).all(),
  database.prepare("SELECT channel,COUNT(*) count FROM reminder_jobs WHERE owner=? AND plan_id=? AND status='unavailable' GROUP BY channel").bind(owner,planId).all(),
 ]);
 return {payments:payments.results,invoices:invoices.results,adapters:adapters.results,unavailableReminderChannels:reminders.results};
}
