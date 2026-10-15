/** Find a substantial neutral paper region, retaining margins and falling back to the full photo. */
export function receiptPaperBounds(data:Uint8ClampedArray|Uint8Array,width:number,height:number){
 const full={x:0,y:0,width,height};if(width<20||height<20||data.length<width*height*4)return full;
 const seen=new Uint8Array(width*height),queue=new Int32Array(width*height);
 const paper=(i:number)=>{const r=data[i*4],g=data[i*4+1],b=data[i*4+2];return Math.min(r,g,b)>135&&Math.max(r,g,b)-Math.min(r,g,b)<45;};
 let largest=0,best=full;
 for(let index=0;index<seen.length;index++){
  if(seen[index]||!paper(index))continue;let head=0,tail=0,left=width,right=0,top=height,bottom=0;queue[tail++]=index;seen[index]=1;
  while(head<tail){const value=queue[head++],x=value%width,y=Math.floor(value/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   for(const next of [x>0?value-1:-1,x<width-1?value+1:-1,y>0?value-width:-1,y<height-1?value+width:-1])if(next>=0&&!seen[next]){seen[next]=1;if(paper(next))queue[tail++]=next;}}
  if(tail>largest){largest=tail;best={x:left,y:top,width:right-left+1,height:bottom-top+1};}
 }
 if(largest<width*height*.12||best.width<width*.3||best.height<height*.35)return full;
 const marginX=Math.ceil(best.width*.04),marginY=Math.ceil(best.height*.04),x=Math.max(0,best.x-marginX),y=Math.max(0,best.y-marginY);
 return {x,y,width:Math.min(width,best.x+best.width+marginX)-x,height:Math.min(height,best.y+best.height+marginY)-y};
}
