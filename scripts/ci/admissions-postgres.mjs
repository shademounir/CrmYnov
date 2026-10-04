import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {accessSync,constants,statSync} from 'node:fs';
import {waitForPostgres} from './postgres-readiness.mjs';
const nonce=randomUUID(),container=`crmy175-ci-${nonce}`;
// Only the official Docker Desktop installation or the hosted Linux runner's
// system executable is trusted. Never resolve an executable from inherited PATH.
const dockerExecutable=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'/usr/bin/docker';
if(!['win32','linux'].includes(process.platform)||!statSync(dockerExecutable).isFile())throw Error('admissions_test_docker_installation_unsupported');
accessSync(dockerExecutable,process.platform==='win32'?constants.F_OK:constants.X_OK);
const docker=args=>execFileSync(dockerExecutable,args,{encoding:'utf8',windowsHide:true,timeout:90_000,stdio:['ignore','pipe','pipe']});
if(process.env.DATABASE_URL)throw Error('admissions_test_must_not_inherit_database');
let created=false;
try{
  docker(['run','-d','--name',container,'--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=crmy175_recipe_synthetic','postgres:17.6-bookworm']);
  created=true;
  await waitForPostgres(container,docker);
  const port=docker(['port',container,'5432/tcp']).trim().split(':').at(-1);
  if(!/^\d+$/.test(port??''))throw Error('admissions_test_port_invalid');
  docker(['exec',container,'psql','-U','postgres','-d','crmy175_recipe_synthetic','-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA crmy175_test_identity; CREATE TABLE crmy175_test_identity.marker(nonce uuid NOT NULL); INSERT INTO crmy175_test_identity.marker VALUES ('${nonce}');`]);
  const env={...process.env,DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/crmy175_recipe_synthetic`,CRMY175_EPHEMERAL_TEST:'true',CRMY175_DATABASE_NONCE:nonce,SHEETS_ENABLED:'false'};
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{env,stdio:'inherit',windowsHide:true,timeout:120_000});
  // Files share the persisted permission epoch. Isolate their fixture writes;
  // the concurrency suite itself still races two real PostgreSQL connections.
  execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','test/admissions-postgres.test.ts','test/admissions-concurrency.test.ts','test/admissions-http-postgres.test.ts'],{cwd:'apps/api',env,stdio:'inherit',windowsHide:true,timeout:180_000});
}finally{
  if(created){
    docker(['stop','--timeout','60',container]);
    console.log(JSON.stringify({proof:'admissions-isolated-postgres',container,preserved:true}));
  }
}
