export type CheckoutPhase='ready'|'opening'|'awaiting'|'confirming'|'success'|'cancelled'|'error'|'review';
type Session={start:(options:{presentationMode:'auto'},order:Promise<{orderId:string}>)=>Promise<unknown>};
export function checkoutErrorMessage(error:unknown){const message=error instanceof Error?error.message:'';if(/client.?token|client.?id|auth|credential|eligible methods/i.test(message))return 'PayPal could not connect. Try again, or ask the plan owner to check the PayPal connection.';if(/popup|blocked|new window/i.test(message))return 'Allow PayPal to open in a new window, then try again.';if(/failed to fetch|network|fetch failed/i.test(message))return 'Check your internet connection and try again.';return message&&message.length<350?message:'PayPal could not start. Please try again.';}
/** One user-started attempt; only PayPal approval can invoke the capture endpoint. */
export function createCheckoutAttempt<T>({createOrder,capture,onCaptured,onChange}:{createOrder:()=>Promise<{orderId:string}>;capture:(id:string)=>Promise<T>;onCaptured:(result:T)=>void;onChange:(phase:CheckoutPhase,message?:string)=>void}){
 let phase:CheckoutPhase='ready',started=false,order:Promise<{orderId:string}>|undefined,confirmation:Promise<void>|undefined;
 const change=(next:CheckoutPhase,message?:string)=>{phase=next;onChange(next,message);};
 const callbacks={
  onApprove:(data:{orderId:string})=>{
   if(!started||!order||phase==='cancelled'||phase==='error')return Promise.resolve();if(confirmation)return confirmation;
   confirmation=(async()=>{change('confirming');try{const saved=await order;if(!data?.orderId||saved.orderId!==data.orderId)throw Error('The approved order changed. Check its saved status.');const result=await capture(saved.orderId);onCaptured(result);change('success');}catch(error){change('review',error instanceof Error?error.message:'Payment confirmation needs a status check.');}})();return confirmation;
  },
  onCancel:()=>{if(!confirmation&&phase!=='success')change('cancelled');},
  onError:(error:unknown)=>{if(!confirmation&&phase!=='success')change('error',checkoutErrorMessage(error));},
 };
 return {callbacks,get phase(){return phase;},start(session:Session){
  if(started)return Promise.resolve();started=true;change('opening');
  // Start synchronously from the click, keeping browser popup activation intact.
  order=Promise.resolve().then(createOrder);void order.catch(()=>{});
  try{return Promise.resolve(session.start({presentationMode:'auto'},order)).then(()=>{if(phase==='opening')change('awaiting');}).catch(error=>{if(!confirmation&&phase!=='success')change('error',checkoutErrorMessage(error));});}
  catch(error){callbacks.onError(error);return Promise.resolve();}
 }};
}
