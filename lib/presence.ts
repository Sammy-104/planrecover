export const PRESENCE_WINDOW=60_000;
export const presenceViews=['today','planner','discover','activity','recovery','people','money','decisions','settings','home','merchant'] as const;
export type PresenceEntry={memberId:string;name:string;initials:string;color:string;status:'viewing'|'editing';view:string;itemId?:string;itemName?:string;seenAt:string};
export function validPresence(value:Record<string,unknown>){
 if(!presenceViews.includes(value.view as any)||!['viewing','editing'].includes(String(value.status)))throw Error('Choose a supported planning presence.');
 if(typeof value.sessionId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(value.sessionId))throw Error('Refresh this plan to reconnect presence.');
 return {sessionId:value.sessionId,view:String(value.view),status:String(value.status) as 'viewing'|'editing',itemId:value.itemId==null?null:String(value.itemId)};
}
