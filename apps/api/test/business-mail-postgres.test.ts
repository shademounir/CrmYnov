import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { BusinessMailJournal, type MailJournalInput } from "../src/business-mail/business-mail-journal.js";

const options = { skip: process.env.CRMY_MAIL_EPHEMERAL_TEST !== "true" };
const digest = (s: string): string => createHash("sha256").update(s).digest("hex");
const input = (label: string): MailJournalInput => ({ key: digest(label), eventType: "FOLLOW_UP_DUE", resourceId: "synthetic-task", templateVersion: "fr-v1", fingerprint: digest("synthetic-content"), recipientSnapshots: [[1, "synthetic-owner", "owner@example.test", "TO", "synthetic-campus", "synthetic-campaign"]] });

test("Business mail real PG: committed unique sending fence, process restart, faults and immutable terminal evidence", options, async () => {
  const url = new URL(process.env.DATABASE_URL ?? ""); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy_mail_synthetic");
  const nonce = process.env.CRMY_MAIL_DATABASE_NONCE; assert.match(nonce ?? "", /^[a-f0-9-]{36}$/);
  const db = new PrismaClient(), a = new BusinessMailJournal(), b = new BusinessMailJournal();
  try {
    assert.deepEqual(await db.$queryRaw`SELECT nonce FROM business_mail_test_identity.marker`, [{ nonce }]);
    const key = input(randomUUID());
    const claims = await Promise.all(Array.from({ length: 51 }, (_, i) => (i % 2 ? a : b).reserveSending(key)));
    assert.equal(claims.filter(r => r.reserved).length, 1, "51 concurrent real PG claims expose only one committed token");
    assert.equal(await db.businessMailDelivery.count({ where: { key: key.key } }), 1);
    const claim = claims.find(r => r.reserved)!; assert(claim.reserved);
    assert.equal(await a.accepted(key.key, randomUUID(), "synthetic-wrong-owner"), false);
    assert.equal(await a.accepted(key.key, claim.token, "synthetic-message-1"), true);
    assert.equal(await b.accepted(key.key, claim.token, "synthetic-message-2"), false);
    assert.equal(await b.uncertain(key.key, claim.token, "TRANSPORT_UNCONFIRMED"), false);
    assert.deepEqual(await b.reserveSending(key), { reserved: false, state: "ACCEPTED" });
    await assert.rejects(() => b.reserveSending({ ...key, fingerprint: digest("different content") }), /business_mail_journal_key_conflict/);
    const accepted = await db.businessMailDelivery.findUniqueOrThrow({ where: { key: key.key } });
    assert.deepEqual(accepted.recipientUserIds, key.recipientSnapshots, "Historical addresses, recipient roles and exact scope survive independently of current profiles");
    await assert.rejects(() => b.reserveSending({ ...key, recipientSnapshots: [[1, "synthetic-owner", "changed@example.test", "TO", "synthetic-campus", "synthetic-campaign"]] }), /business_mail_journal_key_conflict/);
    await assert.rejects(() => db.$executeRaw`UPDATE business_mail_deliveries SET recipient_user_ids=${JSON.stringify([[1, "synthetic-owner", "changed@example.test", "TO", "synthetic-campus", "synthetic-campaign"]])}::jsonb WHERE key=${key.key}`);
    await assert.rejects(() => db.$executeRaw`UPDATE business_mail_deliveries SET status='SENDING',accepted_at=NULL,provider_message_id=NULL WHERE key=${key.key}`);
    await assert.rejects(() => db.$executeRaw`DELETE FROM business_mail_deliveries WHERE key=${key.key}`);
    await assert.rejects(() => db.$executeRawUnsafe('TRUNCATE business_mail_deliveries'));
    assert.deepEqual(await db.businessMailDelivery.findUniqueOrThrow({ where: { key: key.key } }), accepted);

    const crashed = input(randomUUID());
    const script = `import {BusinessMailJournal} from './src/business-mail/business-mail-journal.ts';const j=new BusinessMailJournal();const q=await j.reserveSending(${JSON.stringify(crashed)});if(!q.reserved)throw Error('fixture_conflict');console.log('synthetic_fence_committed');process.exit(23);`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(child.status, 23); assert.match(child.stdout, /synthetic_fence_committed/);
    assert.deepEqual(await a.reserveSending(crashed), { reserved: false, state: "SENDING" }, "A real interrupted process never frees the emission identity");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await a.retainInterrupted(new Date(), 100), 1);
    assert.deepEqual(await b.reserveSending(crashed), { reserved: false, state: "UNCERTAIN" });
    assert.equal(await a.retainInterrupted(new Date(), 100), 0);

    // A deferred trigger rejects COMMIT after INSERT, before reserveSending can expose a token.
    await db.$executeRawUnsafe(`CREATE FUNCTION synthetic_mail_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id='synthetic-commit-failure' THEN RAISE EXCEPTION 'synthetic_commit_failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_mail_commit_fault AFTER INSERT ON business_mail_deliveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_mail_commit_fault()`);
    const failed = { ...input(randomUUID()), resourceId: "synthetic-commit-failure" };
    await assert.rejects(() => a.reserveSending(failed));
    assert.equal(await db.businessMailDelivery.count({ where: { key: failed.key } }), 0, "Failed commit cannot authorize any emission");
    await db.$executeRawUnsafe(`DROP TRIGGER synthetic_mail_commit_fault ON business_mail_deliveries`);
    const fresh = await a.reserveSending(failed); assert(fresh.reserved, "Retry before any committed sending fence is safe");
    assert.equal(await a.uncertain(failed.key, fresh.token, "TRANSPORT_UNCONFIRMED"), true);
    assert.deepEqual(await b.reserveSending(failed), { reserved: false, state: "UNCERTAIN" });

    // Simulated provider acceptance then a real local PG commit failure; no provider is contacted.
    await db.$executeRawUnsafe(`CREATE FUNCTION synthetic_mail_acceptance_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_message_id='synthetic-acceptance-failure' THEN RAISE EXCEPTION 'synthetic_acceptance_commit_failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_mail_acceptance_fault AFTER UPDATE ON business_mail_deliveries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_mail_acceptance_fault()`);
    const ambiguous = input(randomUUID()), emission = await a.reserveSending(ambiguous); assert(emission.reserved);
    await assert.rejects(() => a.accepted(ambiguous.key, emission.token, "synthetic-acceptance-failure"));
    assert.deepEqual(await b.reserveSending(ambiguous), { reserved: false, state: "SENDING" });
    assert.equal(await a.uncertain(ambiguous.key, emission.token, "ACCEPTANCE_COMMIT_UNCONFIRMED"), true);
    assert.equal(await b.accepted(ambiguous.key, emission.token, "synthetic-late-response"), false);
    assert.deepEqual(await b.reserveSending(ambiguous), { reserved: false, state: "UNCERTAIN" });

    const coherent = input(randomUUID()), row = await a.reserveSending(coherent); assert(row.reserved);
    await assert.rejects(() => db.$executeRaw`UPDATE business_mail_deliveries SET status='ACCEPTED',accepted_at=clock_timestamp(),provider_message_id=NULL WHERE key=${coherent.key}`);
    await assert.rejects(() => db.$executeRaw`UPDATE business_mail_deliveries SET status='UNCERTAIN',uncertain_at=clock_timestamp(),uncertainty_code=NULL WHERE key=${coherent.key}`);
    await assert.rejects(() => db.$executeRaw`UPDATE business_mail_deliveries SET fingerprint=${digest("changed")} WHERE key=${coherent.key}`);
    assert.equal(await a.uncertain(coherent.key, row.token, "TRANSPORT_UNCONFIRMED"), true);
    const statuses = await db.businessMailDelivery.findMany({ select: { status: true } });
    assert.equal(statuses.filter(x => x.status === "SENDING").length, 0);
    assert(statuses.every(x => ["ACCEPTED", "UNCERTAIN"].includes(x.status)));
  } finally { await Promise.all([a.close(), b.close(), db.$disconnect()]); }
});
