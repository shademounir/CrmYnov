// Versioned dispatch extension. Historical READ ONLY entry, bytes and pins are unchanged.
import path from 'node:path';import{pathToFileURL}from'node:url';
import{runReadOnlyOperationalDriver}from'./pool-reconciliation/pool-operational-driver-v1.mjs';
export async function runOperationalDriver(args){
 if(args[0]==='image-only')return(await import('./runtime-image-only/cli.mjs')).runImageOnlyOperationalDriver(args.slice(1));
 return runReadOnlyOperationalDriver(args);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const r=await runOperationalDriver(process.argv.slice(2));process.stdout.write(JSON.stringify({schemaVersion:1,...r,canRetry:false,nativeAcceptance:false,sheetsActivated:false})+'\n');}
 catch{process.stderr.write(JSON.stringify({state:'REFUSED',code:'OPERATIONAL_EXTENSION_GUARD',canRetry:false})+'\n');process.exitCode=1;}
}
