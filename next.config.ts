import type { NextConfig } from "next";
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const identity=fileURLToPath(new URL('./platform/vercel/identity-provider.tsx',import.meta.url));

const nextConfig: NextConfig = {
  distDir:'.next-vercel',
  typescript:{tsconfigPath:'tsconfig.vercel.json'},
  poweredByHeader:false,
  serverExternalPackages:['@libsql/client'],
  webpack(config,{isServer,webpack}){
    // Next's tsconfig path resolver can resolve before normal aliases. Replace
    // the module request itself so the real provider reaches both RSC and client builds.
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/(?:^|[\\/])components[\\/]runtime-identity(?:\.tsx)?$/,identity));
    config.resolve.alias={...config.resolve.alias,
      '@/components/runtime-identity':identity,
      [root+'components/runtime-identity.tsx']:identity,
      ...(isServer?{'cloudflare:workers':fileURLToPath(new URL('./lib/vercel/runtime-env.ts',import.meta.url))}:{})};
    if(isServer)config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,fileURLToPath(new URL('./lib/vercel/runtime-env.ts',import.meta.url))));
    return config;
  },
};

export default nextConfig;
