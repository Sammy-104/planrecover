import {searchCities} from '@/lib/city-search';
import {apiError} from '@/lib/store';

export async function GET(request:Request){
 try{
  const cities=await searchCities(new URL(request.url).searchParams.get('q')??'');
  return Response.json({cities},{headers:{'Cache-Control':`private, max-age=${cities.length?3600:30}`}});
 }catch(e){return apiError(e,503);}
}
