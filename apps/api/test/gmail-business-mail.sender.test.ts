import assert from "node:assert/strict";
import test from "node:test";
import { GmailBusinessMailSender } from "../src/business-mail/gmail-business-mail.sender.js";
import type { PreparedBusinessMail } from "../src/business-mail/business-mail-policy.js";
import type { OAuth2Client } from "google-auth-library";

const fixture = (): PreparedBusinessMail => ({ type: "FOLLOW_UP_DUE", key: "a".repeat(64), templateVersion: "fr-v1", leadReference: "LD-SYNTHETIC",
  deadline: "2026-10-21T09:30:00Z", generatedAt: "2026-10-21T11:00:00Z", occurrence: 0,
  to: "owner@example.invalid", cc: ["team@example.invalid"], recipientUserIds: ["owner", "team"] });

async function configured(action: () => Promise<void>): Promise<void> {
  const keys = ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = "synthetic-only";
    process.env.GMAIL_SENDER_EMAIL = "sender@example.invalid";
    process.env.CRM_PUBLIC_ORIGIN = "https://crm.example.invalid";
    await action();
  } finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
class FakeSender extends GmailBusinessMailSender {
  attempts = 0; oauth = 0; raw = ""; observedSignal?: AbortSignal;
  response: Response = Response.json({ id: "synthetic-message-id" });
  protected override accessToken(): Promise<string> { this.oauth++; return Promise.resolve("synthetic-token"); }
  protected override postMessage(_token: string, raw: string, signal: AbortSignal): Promise<Response> {
    this.attempts++; this.raw = Buffer.from(raw, "base64url").toString("utf8"); this.observedSignal = signal;
    return Promise.resolve(this.response.clone());
  }
}

test("internal transport generates minimized French MIME with To/Cc, folded UTF8 and provider ID, no invitation", async () => {
  await configured(async () => {
    const sender = new FakeSender();
    assert.deepEqual(await sender.sendPrepared(fixture(), new AbortController().signal), { providerMessageId: "synthetic-message-id" });
    assert.equal(sender.attempts, 1); assert.equal(sender.oauth, 1);
    assert.match(sender.raw, /To: owner@example\.invalid\r\nCc: team@example\.invalid/u);
    assert.doesNotMatch(sender.raw, /Bcc:|invitation|access-recovery|#token|#code/u);
    const subject = [...sender.raw.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(match => Buffer.from(match[1]!, "base64").toString("utf8")).join("");
    assert.equal(subject, "[CRM Ynov] Relance arrivée à échéance — LD-SYNTHETIC");
    const bodies = sender.raw.split("Content-Transfer-Encoding: base64\r\n\r\n").slice(1).map(part => Buffer.from(part.split("\r\n--crm-business-")[0]!.replaceAll("\r\n", ""), "base64").toString("utf8"));
    assert.equal(bodies.length, 2);
    assert.match(bodies[0]!, /LD-SYNTHETIC/u); assert.match(bodies[0]!, /Retard observé : 90 minute/u);
    assert.match(bodies[0]!, /https:\/\/crm\.example\.invalid\/leads/u);
    assert.match(bodies[1]!, /<p>Bonjour,<\/p>/u);
    assert.ok(sender.raw.split("\r\n").every(line => line.length <= 998));
    assert.ok([...sender.raw.matchAll(/=\?UTF-8\?B\?[^?]+\?=/g)].every(match => match[0].length <= 75));
    const boundary = /boundary="([^"]+)"/u.exec(sender.raw)![1]!; assert.ok(boundary.length <= 70);
    const many = { ...fixture(), cc: Array.from({ length: 99 }, (_, i) => `team${i}@example.invalid`), recipientUserIds: ["owner", ...Array.from({ length: 99 }, (_, i) => `team${i}`)] };
    await sender.sendPrepared(many, new AbortController().signal); assert.ok(sender.raw.split("\r\n").every(line => line.length <= 998));
  });
});

test("internal mail rejects injection, duplicate recipients, cap overflow, invalid template and origin before OAuth", async () => {
  await configured(async () => {
    const invalid = [ { ...fixture(), to: "owner@example.invalid\r\nBcc:prospect@example.invalid" },
      { ...fixture(), cc: ["OWNER@example.invalid"] }, { ...fixture(), cc: Array.from({ length: 100 }, (_, i) => `team${i}@example.invalid`) },
      { ...fixture(), templateVersion: "fr-v2" }, { ...fixture(), key: "invalid" }, { ...fixture(), leadReference: "bad\r\nreference" }, { ...fixture(), recipientUserIds: ["owner"] } ];
    for (const input of invalid) {
      const sender = new FakeSender(); await assert.rejects(sender.sendPrepared(input as PreparedBusinessMail, new AbortController().signal));
      assert.equal(sender.oauth, 0); assert.equal(sender.attempts, 0);
    }
    process.env.CRM_PUBLIC_ORIGIN = "https://crm.example.invalid/unsafe";
    const sender = new FakeSender(); await assert.rejects(sender.sendPrepared(fixture(), new AbortController().signal)); assert.equal(sender.oauth, 0);
    delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    assert.equal(sender.configured(), false); await assert.rejects(sender.sendPrepared(fixture(), new AbortController().signal), /business_mail_transport_unconfigured/u);
  });
});

test("internal mail treats non-OK, missing/invalid ID, JSON and provider errors as uncertain without retry or private errors", async () => {
  await configured(async () => {
    for (const response of [Response.json({ error: "private-response" }, { status: 429 }), Response.json({}), Response.json({ id: "bad\r\nid" }), new Response("invalid-json")]) {
      const sender = new FakeSender(); sender.response = response;
      await assert.rejects(sender.sendPrepared(fixture(), new AbortController().signal), (error: Error) => error.message === "business_mail_send_unconfirmed");
      assert.equal(sender.attempts, 1);
    }
    class Failure extends FakeSender { protected override postMessage(): Promise<Response> { this.attempts++; return Promise.reject(new Error("private-oauth-provider-detail")); } }
    const failed = new Failure(); await assert.rejects(failed.sendPrepared(fixture(), new AbortController().signal), (error: Error) => error.message === "business_mail_send_unconfirmed"); assert.equal(failed.attempts, 1);
    const aborted = new AbortController(); aborted.abort(); const sender = new FakeSender();
    await assert.rejects(sender.sendPrepared(fixture(), aborted.signal), /business_mail_send_unconfirmed/u); assert.equal(sender.oauth, 0); assert.equal(sender.attempts, 0);
  });
});

test("internal mail bounds hanging OAuth, POST and body even when cancellation is ignored", async () => {
  await configured(async () => {
    for (const stage of ["OAUTH", "SEND", "JSON"] as const) {
      let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
      class Hanging extends FakeSender {
        protected override async accessToken(): Promise<string> { if (stage === "OAUTH") await pending; return "synthetic-token"; }
        protected override async postMessage(): Promise<Response> {
          this.attempts++; if (stage === "SEND") await pending;
          return stage === "JSON" ? { ok: true, json: async (): Promise<unknown> => { await pending; return { id: "synthetic-id" }; } } as Response : Response.json({ id: "synthetic-id" });
        }
      }
      const sender = new Hanging(), controller = new AbortController(), started = Date.now();
      const operation = sender.sendPrepared(fixture(), controller.signal); const timer = setTimeout(() => controller.abort(), 20);
      try { await assert.rejects(operation, /business_mail_send_unconfirmed/u); }
      finally { clearTimeout(timer); release(); }
      assert.ok(Date.now() - started < 1000); assert.ok(sender.attempts <= 1);
    }
  });
});

test("internal OAuth refresh uses real library merge retry zero; no Google network or invitation API called", async () => {
  await configured(async () => {
    const controller = new AbortController();
    class OAuthFailure extends GmailBusinessMailSender {
      attempts = 0; retries: number | undefined;
      protected override createClient(signal: AbortSignal): OAuth2Client {
        const client = super.createClient(signal);
        client.transporter.defaults.adapter = options => {
          this.attempts++; this.retries = options.retryConfig?.retry; assert.equal(options.signal, signal);
          controller.abort(); return Promise.reject(new DOMException("synthetic-timeout", "TimeoutError"));
        };
        return client;
      }
      protected override postMessage(): Promise<Response> { assert.fail("no POST after OAuth failure"); }
    }
    const sender = new OAuthFailure(); await assert.rejects(sender.sendPrepared(fixture(), controller.signal), /business_mail_send_unconfirmed/u);
    await new Promise<void>(resolve => { setTimeout(resolve, 100); }); assert.equal(sender.attempts, 1); assert.equal(sender.retries, 0);
  });
});
