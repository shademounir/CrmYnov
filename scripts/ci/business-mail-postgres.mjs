import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {accessSync,constants,statSync} from 'node:fs';
import {waitForPostgres} from './postgres-readiness.mjs';
const nonce=randomUUID(),container=`crm-mail-ci-${nonce}`;
const dockerExecutable=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'/usr/bin/docker';
if(!['win32','linux'].includes(process.platform)||!statSync(dockerExecutable).isFile())throw Error('mail_test_docker_installation_unsupported');
accessSync(dockerExecutable,process.platform==='win32'?constants.F_OK:constants.X_OK);
const docker=args=>execFileSync(dockerExecutable,args,{encoding:'utf8',windowsHide:true,timeout:90000,stdio:['ignore','pipe','pipe']});
if(process.env.DATABASE_URL)throw Error('mail_test_must_not_inherit_database');
let created=false;
try{
  docker(['run','-d','--name',container,'--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=crmy_mail_synthetic','postgres:17.6-bookworm']);created=true;
  await waitForPostgres(container,docker);
  const port=docker(['port',container,'5432/tcp']).trim().split(':').at(-1);if(!/^\d+$/.test(port??''))throw Error('mail_test_port_invalid');
  docker(['exec',container,'psql','-U','postgres','-d','crmy_mail_synthetic','-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA business_mail_test_identity;CREATE TABLE business_mail_test_identity.marker(nonce uuid NOT NULL);INSERT INTO business_mail_test_identity.marker VALUES ('${nonce}');`]);
  const env={...process.env,DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/crmy_mail_synthetic`,CRMY_MAIL_EPHEMERAL_TEST:'true',CRMY_MAIL_DATABASE_NONCE:nonce,SHEETS_ENABLED:'false'};
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{env,stdio:'inherit',windowsHide:true,timeout:120000});
  // Generate Prisma BEFORE starting this fixture, never while synthetic PG is alive.
  execFileSync(process.execPath,['--import','tsx','--test','test/business-mail-postgres.test.ts'],{cwd:'apps/api',env,stdio:'inherit',windowsHide:true,timeout:180000});
}finally{if(created){docker(['stop','--timeout','60',container]);console.log(JSON.stringify({proof:'business-mail-isolated-postgres',container,preserved:true}));}}
