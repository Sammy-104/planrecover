import {activityWords,foldPlaceName,matchesDiscoverySearch,discoveryTopic} from './discovery.ts';
export const searchAreas=[5,20,50,100] as const;
export function searchRadius(value:unknown=20){const radius=Number(value);if(!searchAreas.includes(radius as typeof searchAreas[number]))throw Error('Choose a search area of 5, 20, 50 or 100 km.');return radius;}
export function placeDistance(a:{latitude?:number;longitude?:number},b:{latitude?:number;longitude?:number}){if(![a.latitude,a.longitude,b.latitude,b.longitude].every(v=>typeof v==='number'&&Number.isFinite(v)))return undefined;const r=Math.PI/180,h=Math.sin((b.latitude!-a.latitude!)*r/2)**2+Math.cos(a.latitude!*r)*Math.cos(b.latitude!*r)*Math.sin((b.longitude!-a.longitude!)*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
function edits(a:string,b:string){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}
export function placeMatchScore(name:string,input:string,city=''){
 const folded=foldPlaceName(name),words=activityWords(input,city),query=words.join(' ');if(!words.length)return undefined;
 if(folded===query)return 0;if(folded.startsWith(query))return 1;
 const tokens=folded.split(' '),used=new Set<number>();let score=2;
 for(const word of words){let best=Infinity,index=-1;for(let i=0;i<tokens.length;i++){if(used.has(i))continue;const token=tokens[i],cost=token===word?0:token.startsWith(word)?1:word.length>=4&&Math.abs(word.length-token.length)<=2&&edits(word,token)<=(word.length>=7?2:1)?4:Infinity;if(cost<best){best=cost;index=i;}}if(index<0)return undefined;used.add(index);score+=best;}
 return score;
}
export function rankPlaces<T extends {id:string;name:string;description:string;tags:readonly string[];latitude?:number;longitude?:number}>(places:T[],query:string,city:string,point?:{latitude?:number;longitude?:number},radius=20){
 const category=discoveryTopic(query,city),seen=new Set<string>();
 return places.map(place=>({place,score:!query.trim()?0:category?(matchesDiscoverySearch(place,query,city)?2:undefined):placeMatchScore(place.name,query,city),distance:point?placeDistance(point,place):undefined})).filter(p=>p.score!==undefined&&(p.distance===undefined||p.distance<=radius+.1)).sort((a,b)=>a.score!-b.score!||(a.distance??Infinity)-(b.distance??Infinity)||a.place.name.localeCompare(b.place.name)).filter(p=>{if(seen.has(p.place.id))return false;seen.add(p.place.id);return true;}).map(p=>p.place);
}
