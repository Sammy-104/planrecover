import {normalizeWorkspace,destinationKey,type State,type Action} from './model.ts';

export function sharedTripView(root:State,tripId:string):State{
 const trip=!root.empty&&root.plan.id===tripId?root:root.archives?.find(a=>a.workspace.plan.id===tripId)?.workspace;
 if(!trip)throw Error('This shared plan is no longer available.');
 return {...structuredClone(trip),deletedTrips:[],archives:[],empty:false,demoRemoved:true,version:root.version};
}

export function mergeSharedTrip(root:State,next:State,tripId:string):State{
 if(next.empty||next.plan.id!==tripId||next.archives?.length)throw Error('A shared link can only edit its own plan.');
 const {archives:_,deletedTrips:ignoredDeleted,empty:__,demoRemoved:___,...workspace}=structuredClone(next);
 if(!root.empty&&root.plan.id===tripId)return {...root,...workspace,empty:root.empty,demoRemoved:root.demoRemoved,archives:root.archives,version:root.version};
 const index=root.archives?.findIndex(a=>a.workspace.plan.id===tripId)??-1;
 if(index<0)throw Error('This shared plan is no longer available.');
 const merged=structuredClone(root);merged.archives![index].workspace=workspace;
 return merged;
}

export function checkSharedAction(current:State,action:Action){
 if(['create_trip','delete_trip','restore_trip','select_trip','reset'].includes(action.type))throw Error('Only the plan owner can manage plans.');
 if(action.type==='plan'&&destinationKey((action.plan as Partial<State['plan']>)?.destination??'')!==destinationKey(current.plan.destination))throw Error('Only the plan owner can change the city.');
}

export function hasSharedTrip(root:State,tripId:string){try{sharedTripView(normalizeWorkspace(root),tripId);return true;}catch{return false;}}
