import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { runBusinessMailJob } from "../src/jobs/business-mail.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { BusinessMailRuntime, emptyMailReport } from "../src/business-mail/business-mail-runtime.js";
import { BusinessMailOperator } from "../src/business-mail/business-mail-operator.js";

test("qualified job envelopes verify target/source and close resources; adapters are synthetic with no SQL/OAuth", async t => {
  const env: Record<string, string> = { CRM_BUSINESS_MAIL_ENABLED: "true", CRM_BACKGROUND_WORKERS: "external", CRM_BUSINESS_MAIL_POLICY_QUALIFIED: "true", CRM_RUNTIME_DATABASE_NAME: "crmynov_stg",
    CRM_RUNTIME_DATABASE_ENVIRONMENT: "staging", CRM_RUNTIME_DATABASE_PROJECT: "crmynov-stg-n7x4q2", GOOGLE_CLOUD_PROJECT: "crmynov-stg-n7x4q2", CRM_BUSINESS_MAIL_SOURCE_SHA: "a".repeat(40),
    CRM_BUSINESS_MAIL_OPERATOR_QUALIFIED: "true", CRM_BUSINESS_MAIL_DELEGATION: "crm-ynov-po-delegation-20261001", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/crmynov_stg" };
  const request = { mode: "PAUSE", authorizationSubjectId: "00000000-0000-4000-8000-000000000001", operationId: "00000000-0000-4000-8000-000000000002", expectedVersion: 1, sourceSha: "a".repeat(40), decisionSha256: "b".repeat(64) };
  env.CRM_BUSINESS_MAIL_OPERATION = JSON.stringify(request);
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const messages: string[] = []; let targetReads = 0, closes = 0;
  const fakeClient = { $queryRaw: (): Promise<unknown> => { targetReads++; return Promise.resolve([{ databaseName: "crmynov_stg" }]); } } as unknown as PrismaClient;
  t.mock.getter(PrismaService.prototype, "client", (): PrismaClient => fakeClient);
  t.mock.method(PrismaService.prototype, "onModuleDestroy", (): Promise<void> => { closes++; return Promise.resolve(); });
  const runtime = t.mock.method(BusinessMailRuntime.prototype, "run", (): Promise<ReturnType<typeof emptyMailReport>> => Promise.resolve(emptyMailReport()));
  const operator = t.mock.method(BusinessMailOperator.prototype, "execute", (): Promise<{ version: number; enabled: boolean; activatedAt: null; replayed: boolean }> => Promise.resolve({ version: 2, enabled: false, activatedAt: null, replayed: false }));
  t.mock.method(process.stdout, "write", (chunk: unknown): boolean => { if (typeof chunk === "string") messages.push(chunk); return true; });
  try {
    Object.assign(process.env, env);
    await runBusinessMailJob(); assert.equal(runtime.mock.callCount(), 1); assert.equal(targetReads, 1);
    await runBusinessMailJob("OPERATOR"); assert.equal(operator.mock.callCount(), 1); assert.equal(targetReads, 2);
    assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get("connection_limit"), "2");
    process.env.CRM_BUSINESS_MAIL_OPERATION = JSON.stringify({ ...request, sourceSha: "b".repeat(40) });
    await assert.rejects(runBusinessMailJob("OPERATOR"), /source_mismatch/);
    process.env.CRM_BUSINESS_MAIL_ENABLED = "false"; await runBusinessMailJob(); assert.equal(targetReads, 3, "OFF stops before SQL");
    assert.equal(closes, 3); assert(messages.some(message => message.includes('"completed":true'))); assert(messages.every(message => !message.includes("postgresql://")));
  } finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
