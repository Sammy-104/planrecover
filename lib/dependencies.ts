import type {Item,State} from './model.ts';

/** An edge A -> B means A requires B. Optional support belongs in notes, not this graph. */
export function validateDependencies(items:Pick<Item,'id'|'depends'|'status'>[]){
 const byId=new Map(items.map(item=>[item.id,item]));
 if(byId.size!==items.length)throw Error('Plan item identities must be unique.');
 for(const item of items){
  if(!Array.isArray(item.depends)||item.depends.length>100||new Set(item.depends).size!==item.depends.length)throw Error('Choose each prerequisite once.');
  for(const id of item.depends){
   if(id===item.id)throw Error('An activity cannot depend on itself.');
   const target=byId.get(id);if(!target)throw Error('Choose prerequisites from this plan.');
   if(item.status!=='cancelled'&&target.status==='cancelled')throw Error('An active activity cannot require a cancelled prerequisite.');
  }
 }
 const active=new Set<string>(),complete=new Set<string>();
 function visit(id:string){if(active.has(id))throw Error('These prerequisites form a cycle. Remove a relationship before saving.');if(complete.has(id))return;active.add(id);for(const target of byId.get(id)!.depends)visit(target);active.delete(id);complete.add(id);}
 for(const item of items)visit(item.id);
}

export function dependencyImpact(items:Pick<Item,'id'|'depends'>[],itemId:string){
 const affected=new Set([itemId]);let changed=true;
 while(changed){changed=false;for(const item of items)if(!affected.has(item.id)&&item.depends.some(id=>affected.has(id))){affected.add(item.id);changed=true;}}
 return items.filter(item=>affected.has(item.id)).map(item=>item.id);
}

/** Pending removals retain all group identities so a removed edge cannot bypass review. */
export function assertDependenciesReviewed(items:Pick<Item,'id'|'dependencyReviewPending'>[],itemIds:string[]){
 const targets=new Set(itemIds);
 if(items.some(item=>item.dependencyReviewPending?.affected.some(id=>targets.has(id))))throw Error('Complete group approval of the pending prerequisite changes before starting recovery.');
}

export function dependencyReviewGroup(items:Pick<Item,'id'|'depends'|'dependencyReviewPending'>[],itemId:string,depends:string[]){
 const current=items.find(item=>item.id===itemId),affected=new Set([...dependencyImpact(items,itemId),...(current?.depends??[]),...depends]);
 let changed=true;while(changed){changed=false;for(const item of items){const group=item.dependencyReviewPending?.affected??[];if(group.some(id=>affected.has(id)))for(const id of group)if(!affected.has(id)){affected.add(id);changed=true;}}}
 return [...affected].sort();
}

/** Called only by an explicit confirmed, revision-bound human edit. Financial facts remain intact. */
export function setItemDependencies(state:State,itemId:string,depends:string[],source:string,actor:string,revision:number){
 const item=state.items.find(item=>item.id===itemId);
 if(!item||item.status==='cancelled')throw Error('Choose an active activity.');
 if(item.revision!==revision)throw Error('This revision changed. Review the current prerequisites.');
 if(typeof source!=='string'||!source.trim()||source.trim().length>600)throw Error('Describe the source for these prerequisites, under 600 characters.');
 if(!Array.isArray(depends)||depends.some(id=>typeof id!=='string'))throw Error('Choose valid prerequisites.');
 const next=state.items.map(current=>({...current,depends:current.id===itemId?[...depends]:[...current.depends]}));
 validateDependencies(next);
 const group=dependencyReviewGroup(state.items,itemId,depends),affected=new Set(group);
 item.depends=[...depends].sort();item.dependencyEvidence={source:source.trim(),confirmedBy:actor,confirmedAt:new Date().toISOString()};
 delete item.suggestedDependencies;
 for(const current of state.items)if(affected.has(current.id)&&current.status!=='cancelled'){
  current.revision++;current.approvals=[];current.required=[...new Set([...(current.required??[]),...current.participants])];current.status='draft';current.dependencyReviewPending={affected:group};
 }
}
