import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { compilePostgresProof,createPostgresDocker } from './postgres-proof-runtime.mjs';
import { waitForPostgres } from './postgres-readiness.mjs';
if(process.env.DATABASE_URL)throw Error('first_login_must_not_inherit_database');
const repository=resolve('.'),root=resolve(process.env.CRMY28_FIRST_LOGIN_PROOF_ROOT??process.env.RUNNER_TEMP??tmpdir());
mkdirSync(root,{recursive:true});
const proofDirectory=mkdtempSync(join(root,'crmy28-first-login-'));
compilePostgresProof({repository,proofDirectory,testSource:resolve('apps/api/test/integration/first-login-postgres.test.ts'),errorPrefix:'first_login',requireCommonJs:true,includeDatabaseBindings:true,metadataInputType:'commonjs',metadataProgram:`require('reflect-metadata');
const {FirstLoginService}=require('./compiled/src/first-login/first-login.service.js');
const names=(Reflect.getMetadata('design:paramtypes',FirstLoginService)??[]).map(x=>x?.name);
if(JSON.stringify(names)!==JSON.stringify(['LocalCredentialAdapter','SessionService','AuditService','UserService','PrismaService']))throw Error('first_login_metadata_invalid');
console.log(JSON.stringify({provider:'FirstLoginService',designParamTypes:names}));`});
const nonce=randomUUID(),container=`crmy28-first-login-${nonce}`,database='crmy28_first_login_synthetic';
const {docker,assertContainerAvailable,pinImage,loopbackBinding,ownedContainer}=createPostgresDocker({errorPrefix:'first_login',container,nonce,nonceLabel:'crmy28-first-login-test-nonce'});
let created=false,image;
try{
 assertContainerAvailable();image=pinImage();
 docker(['run','-d','--pull','never','--name',container,'--label',`crmy28-first-login-test-nonce=${nonce}`,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env',`POSTGRES_DB=${database}`,image]);
 created=true;await waitForPostgres(container,docker);const binding=loopbackBinding(image);
 docker(['exec',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA crmy28_first_login_test_identity; CREATE TABLE crmy28_first_login_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy28_first_login_test_identity.marker VALUES ('${nonce}');`]);
 const env={...process.env,DATABASE_URL:`postgresql://postgres@${binding}/${database}`,CRMY28_FIRST_LOGIN_EPHEMERAL_TEST:'true',CRMY28_FIRST_LOGIN_DATABASE_NONCE:nonce,CRM_BACKGROUND_WORKERS:'external',SHEETS_ENABLED:'false'};
 writeFileSync(join(proofDirectory,'run-start.json'),JSON.stringify({nonce,container,database,binding,image,runtime:process.version,sharedDatabaseUsed:false}),{flag:'wx'});
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{env,stdio:'inherit',windowsHide:true,timeout:120000});
 const output=execFileSync(process.execPath,['--test','compiled/test/integration/first-login-postgres.test.js'],{cwd:proofDirectory,env,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:16*1024*1024});
 writeFileSync(join(proofDirectory,'test-output.log'),output,{flag:'wx'});process.stdout.write(output);
}catch(error){writeFileSync(join(proofDirectory,'failure.log'),String(error.stdout??'')+'\n'+String(error.stderr??'')+'\n'+String(error.message),{flag:'wx'});throw error;}
finally{if(created){ownedContainer(image);docker(['stop','--timeout','60',container]);console.log(JSON.stringify({proof:'first-login-isolated-postgres',container,stopped:true,proofDirectory}));}}
