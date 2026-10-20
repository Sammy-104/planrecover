import {issueSignedToken,presignUrl} from '@vercel/blob';

/** Only this ready-to-use PUT URL leaves the server, never its signing material. */
export async function signPrivateUpload(file:{fileKey:string;mime:string;size:number;expires:number},token:string,api={issueSignedToken,presignUrl}){
 const constraints={pathname:file.fileKey,operations:['put' as const],validUntil:file.expires,allowedContentTypes:[file.mime],maximumSizeInBytes:file.size};
 const delegation=await api.issueSignedToken({...constraints,token});
 const {presignedUrl}=await api.presignUrl(delegation,{operation:'put',pathname:file.fileKey,access:'private',validUntil:file.expires,allowedContentTypes:[file.mime],maximumSizeInBytes:file.size,addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60});
 return presignedUrl;
}
