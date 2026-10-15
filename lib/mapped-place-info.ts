import {mappedPlaceInfo} from './place-info.ts';
const recent=new Map<string,{at:number;details:ReturnType<typeof mappedPlaceInfo>}>();
export async function mappedInfo(id:string,request:typeof fetch=fetch){
 const match=/^osm-(node|way|relation)-(\d+)$/.exec(id);if(!match)return {};
 const remembered=recent.get(id);if(remembered&&Date.now()-remembered.at<3600000)return remembered.details;
 for(const endpoint of ['https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter']){
  try{const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:`[out:json][timeout:5];${match[1]}(${match[2]});out tags;`}),signal:AbortSignal.timeout(6000)});if(!response.ok)continue;
   const body=await response.json() as any,element=body.elements?.find((e:any)=>e.type===match[1]&&String(e.id)===match[2]);if(element?.tags){const details=mappedPlaceInfo(element.tags,`https://www.openstreetmap.org/${match[1]}/${match[2]}`);if(recent.size>=500)recent.delete(recent.keys().next().value!);recent.set(id,{at:Date.now(),details});return details;}
  }catch{/* Details are optional; an unavailable source must not block adding a real place. */}
 }
 return {};
}
