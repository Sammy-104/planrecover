'use client';
import {useEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {moneyInput,parseMoney} from '@/lib/money';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'> & {value:number|'';currency:string;onChange:(minorUnits:number)=>void};

/** Keep typed decimals intact; only format after the person leaves the field. */
export function MoneyInput({value,currency,onChange,onFocus,onBlur,...props}:Props){
 const display=(amount:number|'')=>amount===''||!Number.isSafeInteger(amount)?'':moneyInput(amount,currency);
 const [text,setText]=useState(()=>display(value)),editing=useRef(false),previousCurrency=useRef(currency);
 useEffect(()=>{
  const currencyChanged=previousCurrency.current!==currency;previousCurrency.current=currency;
  const parsed=parseMoney(text,currency),same=typeof value==='number'&&(Object.is(parsed,value)||parsed===value);
  if(currencyChanged||!editing.current||!same&&Number.isSafeInteger(value))setText(display(value));
 },[value,currency]);
 const parsed=parseMoney(text,currency),invalid=text!==''&&!Number.isSafeInteger(parsed);
 return <input {...props} type="text" inputMode="decimal" autoComplete="off" value={text} aria-invalid={invalid||undefined}
  onFocus={event=>{editing.current=true;onFocus?.(event);}}
  onChange={event=>{setText(event.target.value);onChange(parseMoney(event.target.value,currency));}}
  onBlur={event=>{editing.current=false;if(Number.isSafeInteger(parsed))setText(moneyInput(parsed,currency));onBlur?.(event);}}/>;
}
