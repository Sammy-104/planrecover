export function localDateTime(iso:string,zone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const get=(key:string)=>parts.find(p=>p.type===key)?.value??'';
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function zonedStart(local:string,zone:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw Error('Choose a valid local date and time.');
 const wall=Date.parse(`${local}:00Z`);if(!Number.isFinite(wall))throw Error('Choose a valid local date and time.');
 let instant=wall;
 for(let i=0;i<3;i++){
  const represented=Date.parse(`${localDateTime(new Date(instant).toISOString(),zone)}:00Z`);
  instant=wall-(represented-instant);
 }
 if(localDateTime(new Date(instant).toISOString(),zone)!==local)throw Error('This local time is not available in the selected time zone. Choose another time.');
 const offset=Math.round((wall-instant)/60000),sign=offset<0?'-':'+';
 return `${local}:00${sign}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
}
export function tripDays(start:string,end:string){
 const days:string[]=[];let t=Date.parse(start+'T12:00:00Z'),last=Date.parse(end+'T12:00:00Z');
 if(!Number.isFinite(t)||!Number.isFinite(last)||last<t||last-t>366*86400000)return days;
 for(;t<=last;t+=86400000)days.push(new Date(t).toISOString().slice(0,10));return days;
}
export function validTripDates(start:string,end:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return false;
 const first=new Date(start+'T12:00:00Z'),last=new Date(end+'T12:00:00Z');
 return Number.isFinite(first.getTime())&&Number.isFinite(last.getTime())&&first.toISOString().slice(0,10)===start&&last.toISOString().slice(0,10)===end&&tripDays(start,end).length>0;
}
