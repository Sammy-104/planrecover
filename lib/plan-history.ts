import type {State,Item} from './model.ts';
import {scheduleLocked,type TravelMode} from './schedule.ts';
export type ScheduleUndo={id:string;actor:string;created:string;previousMode?:TravelMode;changes:{itemId:string;before:string;after:string;revision:number}[]};
export function latestMove(state:State,actor:string){return [...(state.scheduleUndo??[])].reverse().find(move=>move.actor===actor);}
export function undoMoveAvailable(state:State,move:ScheduleUndo){return move.changes.every(change=>{const item=state.items.find(i=>i.id===change.itemId);return item&&!scheduleLocked(item)&&item.start===change.after&&item.revision===change.revision&&!item.approvals.length;});}
export function captureMove(items:Item[],changes:{itemId:string;start:string}[],actor:string,previousMode?:TravelMode):ScheduleUndo{return {id:crypto.randomUUID(),actor,created:new Date().toISOString(),previousMode,changes:changes.map(change=>{const item=items.find(i=>i.id===change.itemId)!;return {itemId:item.id,before:item.start,after:change.start,revision:item.revision+1};})};}
