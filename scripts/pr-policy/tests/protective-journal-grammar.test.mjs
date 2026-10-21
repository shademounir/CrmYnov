import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {analyzeMigrationSql} from '../migration-policy.mjs';
import {sqlStatements} from '../migration-grammar.mjs';
import {protectiveJournalBody,recognizedProtectiveJournalStatements} from '../protective-journal-grammar.mjs';

const markers='-- prisma-policy: additive\n-- prisma-policy: ephemeral-only\n-- prisma-policy: rollback-documented\n';
const table=`CREATE TABLE "synthetic_deliveries" (
 "key" VARCHAR(64) PRIMARY KEY CHECK ("key" ~ '^[a-f0-9]{64}$'),
 "event_type" TEXT NOT NULL, "resource_id" TEXT NOT NULL, "template_version" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL,"recipient_user_ids" JSONB NOT NULL,"status" TEXT NOT NULL DEFAULT 'SENDING',
 "sending_token" UUID NOT NULL UNIQUE,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "sending_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"accepted_at" TIMESTAMPTZ,"uncertain_at" TIMESTAMPTZ,
 "provider_message_id" TEXT,"uncertainty_code" TEXT
);`;
const fn=`CREATE FUNCTION "synthetic_delivery_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$${protectiveJournalBody}$$;`;
const row=`CREATE TRIGGER "synthetic_row_guard" BEFORE INSERT OR UPDATE OR DELETE ON "synthetic_deliveries" FOR EACH ROW EXECUTE FUNCTION "synthetic_delivery_guard"();`;
const truncate=`CREATE TRIGGER "synthetic_truncate_guard" BEFORE TRUNCATE ON "synthetic_deliveries" FOR EACH STATEMENT EXECUTE FUNCTION "synthetic_delivery_guard"();`;
const fixture=(...statements)=>markers+[table,fn,row,truncate,...statements].join('\n');

test('only complete protective mail-journal group on a new table is recognized; comments, keyword case and dollar tag do not alter semantics',()=>{
 for(const sql of [fixture(),fixture().replace('AS $$','AS $protective$').replace('$$;','$protective$;'),fixture().replace('RETURN NEW;','return new;'),fixture().replace('BEGIN','BEGIN\n-- bounded comment')]){
   assert.equal(analyzeMigrationSql(sql).approved,true);
   assert.equal(recognizedProtectiveJournalStatements(sqlStatements(sql)).size,3);
 }
});

test('complete prepared mail-journal specimen passes without weakening or dropping its guards',()=>{
 const specimen=readFileSync(new URL('../fixtures/protective-mail-journal.sql',import.meta.url),'utf8');
 assert.equal(analyzeMigrationSql(specimen).approved,true);
 assert.equal(recognizedProtectiveJournalStatements(sqlStatements(specimen)).size,3);
});

test('all body predicates and literal values are binding, never normalized to generic string literals',()=>{
 for(const [original,replacement] of [
  ["TG_OP IN ('DELETE','TRUNCATE')","TG_OP IN ('DELETE')"],
  ["NEW.status <> 'SENDING'","NEW.status = 'SENDING'"],
  ["RETURN NEW;","RETURN OLD;"],
  ["'23514'","'00000'"],
  ["IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;",""],
  ["NEW.fingerprint,",""],
  ["OLD.fingerprint,",""],
  ["'ACCEPTED','UNCERTAIN'","'ACCEPTED','SENDING'"],
  ["OR OLD.status <> 'SENDING'","OR FALSE"],
  ["RETURN NEW;\nEND;","PERFORM dangerous(); RETURN NEW;\nEND;"],
  ["RETURN NEW;\nEND;","EXECUTE 'DELETE FROM synthetic_deliveries'; RETURN NEW;\nEND;"],
  ["RETURN NEW;","RETURN @;"],
  ["business_mail_journal_delete_forbidden","other_error"],
 ]) assert.equal(analyzeMigrationSql(fixture().replace(original,replacement)).approved,false,original);
});

test('missing or changed triggers, existing tables, replace/definer functions and additional SQL remain blocked',()=>{
 for(const sql of [
  markers+[fn,row,truncate].join('\n'),fixture().replace(row,''),fixture().replace(truncate,''),
  fixture().replace('BEFORE INSERT OR UPDATE OR DELETE','AFTER INSERT OR UPDATE OR DELETE'),
  fixture().replace('BEFORE INSERT OR UPDATE OR DELETE','BEFORE UPDATE OR DELETE'),
  fixture().replace('BEFORE TRUNCATE','AFTER TRUNCATE'),fixture().replace('FOR EACH STATEMENT','FOR EACH ROW'),
  fixture().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),
  fixture().replace('LANGUAGE plpgsql AS','LANGUAGE plpgsql SECURITY DEFINER AS'),
  fixture().replace('LANGUAGE plpgsql AS','LANGUAGE sql AS'),
  fixture().replace('EXECUTE FUNCTION "synthetic_delivery_guard"','EXECUTE FUNCTION "different_guard"'),
  fixture().replace('ON "synthetic_deliveries"','ON "existing_rows"'),
  fixture().replace('"fingerprint" TEXT NOT NULL,',''),
  fixture(row),fixture(truncate),fixture('DELETE FROM "synthetic_deliveries";'),
  fixture('UPDATE "synthetic_deliveries" SET status = \'SENDING\';'),fixture('TRUNCATE "synthetic_deliveries";'),
  fixture('DROP TABLE "synthetic_deliveries";'),fixture('GRANT ALL ON "synthetic_deliveries" TO PUBLIC;'),
  fixture('CREATE FUNCTION "arbitrary"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;'),
 ]) assert.equal(analyzeMigrationSql(sql).approved,false,sql.slice(-150));
});

test('dollar quoting is lexical only: unterminated, unknown syntax and unrelated function bodies fail closed',()=>{
 for(const sql of [markers+'CREATE FUNCTION "f"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;',fixture().replace('$$;','$wrong$;'),fixture().replace('AS $$','AS $9$'),markers+'CREATE TABLE unrelated (value TEXT DEFAULT $$literal$$);',markers+table]) assert.equal(analyzeMigrationSql(sql).approved,false);
 assert.equal(analyzeMigrationSql(fixture('CREATE TABLE unrelated (value TEXT CHECK (value ~ \'safe\'));')).approved,false,'regex lexing is limited to the recognized journal table, not every CREATE TABLE in a protective migration');
 assert.equal(analyzeMigrationSql(fixture(),{markers:['additive','ephemeral-only','rollback-documented'],protectiveFunctionApproved:true}).approved,true);
 assert.equal(analyzeMigrationSql(fixture().replace('RETURN NEW;','RETURN OLD;'),{protectiveFunctionApproved:true}).approved,false,'unrecognized evidence never authorizes altered code');
});
