/** One deadline across provider fallbacks keeps a place search from waiting on every upstream timeout. */
export function boundedPlaceRequest(request:typeof fetch,milliseconds:number):typeof fetch{
 const deadline=AbortSignal.timeout(milliseconds);
 return (input,options={})=>{deadline.throwIfAborted();return request(input,{...options,signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline});};
}
