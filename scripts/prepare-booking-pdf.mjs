import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.dirname(require.resolve('pdfjs-dist/package.json')),target=path.resolve('public/vendor/pdfjs');
await mkdir(target,{recursive:true});await cp(path.join(root,'build/pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs'));await cp(path.join(root,'cmaps'),path.join(target,'cmaps'),{recursive:true});await cp(path.join(root,'standard_fonts'),path.join(target,'standard_fonts'),{recursive:true});await cp(path.join(root,'LICENSE'),path.join(target,'LICENSE'));const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));await writeFile(path.join(target,'version.json'),JSON.stringify({version:pkg.version}));
