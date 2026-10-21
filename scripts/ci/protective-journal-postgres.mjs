// Isolated synthetic PostgreSQL ONLY. No host port, inherited DB or provider calls.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import assert from 'node:assert/strict';
import {analyzeMigrationSql} from '../pr-policy/migration-policy.mjs';
import {waitForPostgres} from './postgres-readiness.mjs';
if(process.env.DATABASE_URL)throw new Error('protective_journal_no_inherited_database');
const executable=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'/usr/bin/docker';
if(!['win32','linux'].includes(process.platform)||!statSync(executable).isFile())throw new Error('protective_journal_docker_unsupported');
const docker=args=>execFileSync(executable,args,{encoding:'utf8',windowsHide:true,timeout:90000,stdio:'pipe'}),container='crm-protective-journal-'+randomUUID();
const specimen=readFileSync(new URL('../pr-policy/fixtures/protective-mail-journal.sql',import.meta.url),'utf8');assert(analyzeMigrationSql(specimen).approved);
let created=false;const sql=source=>execFileSync(executable,['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','crm_protective_synthetic','-At'],{input:source,encoding:'utf8',windowsHide:true,timeout:30000,stdio:'pipe'}).trim();
try{
 docker(['run','-d','--name',container,'--network','none','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=crm_protective_synthetic','postgres:17.6-bookworm']);created=true;
 await waitForPostgres(container,docker);
 sql("CREATE TABLE existing_business_rows(id integer PRIMARY KEY, value text NOT NULL);INSERT INTO existing_business_rows VALUES(1,'synthetic-preserve');");
 const before=sql('SELECT row_to_json(t) FROM existing_business_rows t ORDER BY id;');sql(specimen);assert.equal(sql('SELECT row_to_json(t) FROM existing_business_rows t ORDER BY id;'),before);
 const key='a'.repeat(64),fingerprint='b'.repeat(64),token=randomUUID();
 const insert=`INSERT INTO business_mail_deliveries(key,event_type,resource_id,template_version,fingerprint,recipient_user_ids,sending_token) VALUES ('${key}','FOLLOW_UP_DUE','synthetic-resource','fr-v1','${fingerprint}','["synthetic-owner"]','${token}');`;
 sql(insert);assert.equal(sql('SELECT status FROM business_mail_deliveries;'),'SENDING');
 let negativeAssertions=0;const rejects=source=>{assert.throws(()=>sql(source));negativeAssertions++;};
 rejects(insert);rejects("DELETE FROM business_mail_deliveries;");rejects('TRUNCATE business_mail_deliveries;');
 for(const [column,value] of [['key',`'${'c'.repeat(64)}'`],['event_type',"'RETURN_EXPECTED'"],['resource_id',"'other'"],['template_version',"'fr-v2'"],['fingerprint',`'${'d'.repeat(64)}'`],['recipient_user_ids',"'[\"other\"]'::jsonb"],['sending_token',`'${randomUUID()}'::uuid`],['created_at',"clock_timestamp() + interval '1 day'"],['sending_at',"clock_timestamp() + interval '1 day'"]])rejects(`UPDATE business_mail_deliveries SET ${column}=${value};`);
 rejects("UPDATE business_mail_deliveries SET status='ACCEPTED',accepted_at=clock_timestamp();");
 sql("UPDATE business_mail_deliveries SET status='ACCEPTED',accepted_at=clock_timestamp(),provider_message_id='synthetic-id';");
 const accepted=sql('SELECT row_to_json(t) FROM business_mail_deliveries t;');
 rejects("UPDATE business_mail_deliveries SET status='SENDING',accepted_at=NULL,provider_message_id=NULL;");
 rejects("UPDATE business_mail_deliveries SET provider_message_id='different-id';");
 rejects("UPDATE business_mail_deliveries SET status='UNCERTAIN',accepted_at=NULL,provider_message_id=NULL,uncertain_at=clock_timestamp(),uncertainty_code='PROCESS_INTERRUPTED';");
 assert.equal(sql('SELECT row_to_json(t) FROM business_mail_deliveries t;'),accepted);
 sql(insert.replaceAll(key,'e'.repeat(64)).replaceAll(token,randomUUID()));
 sql("UPDATE business_mail_deliveries SET status='UNCERTAIN',uncertain_at=clock_timestamp(),uncertainty_code='PROCESS_INTERRUPTED' WHERE status='SENDING';");
 rejects("UPDATE business_mail_deliveries SET uncertainty_code='TRANSPORT_UNCONFIRMED' WHERE status='UNCERTAIN';");
 rejects("TRUNCATE business_mail_deliveries;");
 assert.equal(sql('SELECT count(*) FROM business_mail_deliveries;'),'2');assert.equal(sql('SELECT row_to_json(t) FROM existing_business_rows t ORDER BY id;'),before);
 console.log(JSON.stringify({verified:true,proof:'protective-mail-journal-real-postgres',negativeAssertions,priorRowsUnchanged:true,terminalRows:2,providerCalled:false,productionMutation:false,container}));
}finally{if(created){docker(['stop','--timeout','60',container]);console.log(JSON.stringify({container,stopped:true,preserved:true}));}}
