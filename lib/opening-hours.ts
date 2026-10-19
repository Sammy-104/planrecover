const weekdays=['Su','Mo','Tu','We','Th','Fr','Sa'];
/** Deliberately limited to explicit weekly hours. Holidays/sunrise/conditional rules stay unknown. */
export function listedWindows(hours:string|undefined,day:string):[number,number][]|undefined{
 if(!hours)return undefined;if(hours==='24/7')return [[0,2880]];
 const date=new Date(day+'T12:00:00Z'),today=date.getUTCDay(),windows:[number,number][]=[];
 for(const raw of hours.split(';')){
  const match=/^\s*(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?((?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*))?\s*(off|closed|\d{2}:\d{2}-\d{2}:\d{2}(?:\s*,\s*\d{2}:\d{2}-\d{2}:\d{2})*)\s*$/.exec(raw);
  if(!match)return undefined;
  const days=new Set<number>();if(!match[1])weekdays.forEach((_,i)=>days.add(i));else for(const range of (match[1]+(match[2]?'-'+match[2]:'')+(match[3]??'')).split(',')){const [first,last=first]=range.split('-'),start=weekdays.indexOf(first),end=weekdays.indexOf(last);for(let n=start;;n=(n+1)%7){days.add(n);if(n===end)break;}}
  const periods=match[4];if(periods==='off'||periods==='closed'){if(days.has(today)){for(let i=windows.length-1;i>=0;i--)if(windows[i][0]>=0)windows.splice(i,1);}continue;}
  for(const period of periods.split(',')){const [a,b]=period.trim().split('-'),minute=(value:string)=>{const [h,m]=value.split(':').map(Number);return h<=24&&m<60&&(h<24||m===0)?h*60+m:NaN;},start=minute(a),end=minute(b);if(!Number.isFinite(start)||!Number.isFinite(end))return undefined;
   if(days.has(today))windows.push([start,end<=start?end+1440:end]);
   if(end<=start&&days.has((today+6)%7))windows.push([start-1440,end]);
  }
 }return windows;
}
