import {bedrockConfig,BedrockError} from './bedrock.ts';

/** Reviewed public list rates, never a currency conversion or an AWS invoice. */
export const BEDROCK_PRICING_PRESET='aws-nova-lite-ca-standard-2026-10-19';
const preset={id:BEDROCK_PRICING_PRESET,model:'Amazon Nova Lite 1.0',sourceRegion:'ca-central-1',currency:'USD' as const,
 serviceTier:'standard',routing:'canada-geographic-cross-region',inputUsdPerMillionTokens:0.064,outputUsdPerMillionTokens:0.256,
 checkedAt:'2026-10-19',reviewBy:'2026-11-18',publishedAt:'2026-10-16T21:08:06Z',
 sourceUrl:'https://aws.amazon.com/bedrock/pricing/',
 dataUrl:'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/bedrock/USD/current/bedrock.json'};
export type BedrockPricingStatus='configured'|'not-configured'|'binding-required'|'model-mismatch'|'review-required';
export type BedrockPricingView={status:BedrockPricingStatus;basis:typeof preset|null};
const invalid=()=>new BedrockError('BEDROCK_CONFIG','The explicit AI pricing settings are invalid.',503);
function price(value:unknown){
 if(value===undefined||value==='')return null;
 if(typeof value!=='string'&&typeof value!=='number')throw invalid();
 if(typeof value==='string'&&!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value))throw invalid();
 const result=Number(value);if(!Number.isFinite(result)||result<0||result>100_000)throw invalid();return result;
}
/** Syntactic validation is synchronous so owner readiness can flag malformed settings. */
export function bedrockPricingSettings(settings:Record<string,unknown>){
 const input=price(settings.BEDROCK_INPUT_USD_PER_MILLION_TOKENS),output=price(settings.BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS);
 if((input===null)!==(output===null))throw invalid();
 const id=settings.BEDROCK_PRICING_PRESET,binding=settings.BEDROCK_PRICING_MODEL_SHA256;
 if(id!==undefined&&id!==''&&id!==BEDROCK_PRICING_PRESET)throw invalid();
 if(binding!==undefined&&binding!==''&&(typeof binding!=='string'||!/^[0-9a-f]{64}$/.test(binding)))throw invalid();
 if(id===BEDROCK_PRICING_PRESET&&input!==null&&(input!==preset.inputUsdPerMillionTokens||output!==preset.outputUsdPerMillionTokens))throw invalid();
 return {inputUsdPerMillionTokens:input,outputUsdPerMillionTokens:output,preset:id===BEDROCK_PRICING_PRESET?{...preset}:null,
  binding:typeof binding==='string'&&binding?binding:null};
}
/** Private binding ties the reviewed rates to the exact runtime profile and source region.
 * Never return this fingerprint or the model/profile identifier through an owner/public API. */
export async function bedrockPricingModelHash(settings:Record<string,unknown>){
 const config=bedrockConfig(settings);if(!config)throw invalid();
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,region:config.region,modelId:config.modelId})));
 return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function readBedrockPricing(settings:Record<string,unknown>,now=Date.now()):Promise<BedrockPricingView>{
 const parsed=bedrockPricingSettings(settings);
 if(!parsed.preset)return {status:parsed.inputUsdPerMillionTokens===null?'not-configured':'binding-required',basis:null};
 const basis=parsed.preset;
 if(!parsed.binding)return {status:'binding-required',basis};
 const config=bedrockConfig(settings);
 if(!config||config.region!==basis.sourceRegion||!(config.modelId==='ca.amazon.nova-lite-v1:0'||/^arn:aws:bedrock:ca-central-1:\d{12}:application-inference-profile\/[a-zA-Z0-9._:-]+$/.test(config.modelId))
  ||parsed.binding!==await bedrockPricingModelHash(settings))return {status:'model-mismatch',basis};
 if(!Number.isFinite(now)||now<Date.parse(basis.checkedAt+'T00:00:00Z')||now>=Date.parse(basis.reviewBy+'T00:00:00Z'))return {status:'review-required',basis};
 return {status:'configured',basis};
}
