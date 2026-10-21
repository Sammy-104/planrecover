import {RuntimeSignIn} from '@/components/runtime-identity';
import {safeReturnTo} from '@/platform/vercel/identity';
export default async function SignInPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,returnTo=safeReturnTo(params.return_to);
 return <main className="welcome-screen"><a className="brand" href="/">PlanRecover</a><section className="welcome-content"><div className="welcome-copy"><h1>Sign in to your plans</h1><p>Your saved plans and shared decisions stay with your account.</p><RuntimeSignIn returnTo={returnTo}/></div></section></main>;
}
