import {RuntimeSignOut} from '@/components/runtime-identity';
import {safeReturnTo} from '@/platform/vercel/identity';
export default async function SignOutPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;
 return <main className="welcome-screen"><h1>Sign out</h1><RuntimeSignOut returnTo={safeReturnTo(params.return_to)}/></main>;
}
