import {applyAction,type Action} from './model';
import {loadAccess,saveAccess,requireEdit,publicState,collaboration,type WorkspaceAccess} from './store';
export const discussionActions=['activity_comment','activity_comment_delete','activity_vote','activity_priority'];
/** These actions merge only the signed-in member's feedback, never schedule or money fields. */
export async function saveDiscussion(access:WorkspaceAccess,action:Action){
 for(let attempt=0;attempt<3;attempt++){
  const current=await loadAccess(access);requireEdit(access,current);if(current.people)action.actor=access.user!.id;
  const next=applyAction(current,action);
  try{const saved=await saveAccess(access,next,current.version);return {state:publicState(saved,access),collaboration:await collaboration(access,saved)};}catch(e){if(attempt===2||!(e instanceof Error)||!e.message.includes('Refresh'))throw e;}
 }
 throw Error('The discussion changed. Refresh and try again.');
}
