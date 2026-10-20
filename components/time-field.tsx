'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Clock} from 'lucide-react';
import {parseTimeInput,validLocalDateTime} from '@/lib/time-input';

type Props={value:string;onChange:(value:string)=>void;min?:string;max?:string;disabled?:boolean;required?:boolean;id?:string;'aria-label'?:string};

/** A normal text box supports keyboard entry, with an optional native picker. */
export function TimeField({value,onChange,min,max,disabled,required,id,'aria-label':label}:Props){
 const generated=useId(),inputId=id??generated,[text,setText]=useState(value),[touched,setTouched]=useState(false),picker=useRef<HTMLInputElement>(null),textInput=useRef<HTMLInputElement>(null),editing=useRef(false);
 useEffect(()=>{if(!editing.current)setText(value);},[value]);
 const parsed=parseTimeInput(text),invalid=parsed===null||!!(required&&!parsed)||!!(parsed&&((min&&parsed<min)||(max&&parsed>max)));
 useEffect(()=>{textInput.current?.setCustomValidity(invalid?'Enter a valid time within the selected range.':'');},[invalid]);
 function edit(raw:string){setText(raw);const complete=/^\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?$/i.test(raw.trim())||/^\d{1,2}\s*[ap]\.?m\.?$/i.test(raw.trim())||/^\d{4}$/.test(raw.trim());onChange(complete&&parsedTime(raw)!==null?parsedTime(raw)!:raw);}
 function parsedTime(raw:string){return parseTimeInput(raw);}
 return <span className="time-field"><span className="time-field-controls"><input ref={textInput} id={inputId} type="text" inputMode="text" autoComplete="off" placeholder="9:30 AM" value={text} disabled={disabled} required={required} aria-label={label} aria-invalid={invalid||undefined} aria-describedby={inputId+'-hint'} onFocus={()=>{editing.current=true;}} onChange={event=>edit(event.target.value)} onBlur={()=>{editing.current=false;setTouched(true);if(parsed!==null){setText(parsed);onChange(parsed);}}}/><button type="button" className="icon-button time-picker-button" disabled={disabled} aria-label={label?`Choose ${label.toLowerCase()}`:'Choose time'} onClick={()=>{try{if(typeof picker.current?.showPicker==='function')picker.current.showPicker();else textInput.current?.focus();}catch{textInput.current?.focus();}}}><Clock size={16}/></button><input ref={picker} className="time-native-picker" type="time" value={parsed??''} min={min} max={max} disabled={disabled} tabIndex={-1} aria-hidden="true" onChange={event=>{setText(event.target.value);onChange(event.target.value);setTouched(false);}}/></span><small id={inputId+'-hint'} className={invalid&&touched?'inline-error':'time-field-hint'}>{invalid&&touched?'Enter a valid time, such as 9:30 AM or 14:30.':'Type a time, such as 9:30 AM or 14:30.'}</small></span>;
}

export function DateTimeField({value,onChange,min,max,disabled,required,id,'aria-label':label}:Props){
 const generated=useId(),prefix=id??generated,fieldLabel=label?.replace(/\s+(?:date|time)$/i,''),split=value.indexOf('T'),date=split<0?value:value.slice(0,split),time=split<0?'':value.slice(split+1);
 const [dateValue,setDate]=useState(date),[timeValue,setTime]=useState(time);
 useEffect(()=>{setDate(date);setTime(time);},[value]);
 function update(nextDate:string,nextTime:string){setDate(nextDate);setTime(nextTime);onChange(!nextDate&&!nextTime?'':`${nextDate}T${nextTime}`);}
 return <span className="date-time-field" data-invalid={value&&!validLocalDateTime(value)?'true':undefined}><input type="date" id={prefix+'-date'} aria-label={fieldLabel?`${fieldLabel} date`:'Date'} value={dateValue} min={min?.slice(0,10)} max={max?.slice(0,10)} disabled={disabled} required={required} onChange={event=>update(event.target.value,timeValue)}/><TimeField id={prefix+'-time'} aria-label={fieldLabel?`${fieldLabel} time`:'Time'} value={timeValue} min={dateValue===min?.slice(0,10)?min?.slice(11,16):undefined} max={dateValue===max?.slice(0,10)?max?.slice(11,16):undefined} disabled={disabled} required={required} onChange={next=>update(dateValue,next)}/></span>;
}
