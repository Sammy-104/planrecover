import {RuntimeSignUp} from '@/components/runtime-identity';
import {safeReturnTo} from '@/platform/vercel/identity';
export default async function SignUpPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,returnTo=safeReturnTo(params.return_to);
 return <main className="welcome-screen"><a className="brand" href="/">PlanRecover</a><section className="welcome-content"><div className="welcome-copy"><h1>Create your account</h1><p>Save your plans and join your friends.</p><RuntimeSignUp returnTo={returnTo}/></div></section></main>;
}
