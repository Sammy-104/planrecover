/** Human input stays local; stored timestamps still use the plan's IANA zone. */
export function parseTimeInput(value:string):string|null {
 const text=value.trim().toLowerCase().replace(/\./g,'').replace(/\s+/g,'');
 if(!text)return '';
 const match=text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
 const compact=!match?text.match(/^(\d{2})(\d{2})$/):null;
 if(!match&&!compact)return null;
 let hour=Number((match??compact)![1]),minute=Number((match??compact)![2]??0);
 const period=match?.[3];
 if(minute>59||hour>(period?12:23)||(period&&hour<1))return null;
 if(period)hour=hour%12+(period==='pm'?12:0);
 return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}

export function validLocalDateTime(value:string,required=false):boolean {
 if(!value)return !required;
 const match=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
 if(!match||parseTimeInput(match[2])!==match[2])return false;
 const date=new Date(match[1]+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===match[1];
}
