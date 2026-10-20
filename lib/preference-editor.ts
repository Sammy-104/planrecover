/** Remote refreshes must not erase a person's unfinished settings form. */
export function preferenceEditorUpdate(input:{previousScope:string;previousSaved:string;scope:string;saved:string;draft:string;dirty:boolean}):'none'|'reset'|'saved'|'conflict'{
 if(input.scope!==input.previousScope)return 'reset';
 if(input.saved===input.previousSaved)return 'none';
 if(!input.dirty)return 'reset';
 return input.saved===input.draft?'saved':'conflict';
}
