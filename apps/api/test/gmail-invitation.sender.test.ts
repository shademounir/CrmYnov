import assert from "node:assert/strict";
import test from "node:test";
import type { OAuth2Client } from "google-auth-library";
import { GmailInvitationSender } from "../src/invitations/gmail-invitation.sender.js";

class FakeSender extends GmailInvitationSender {
  sent: Array<{ token: string; raw: string; signal?: AbortSignal }> = [];
  response: Response = Response.json({ id: "synthetic-gmail-message" });
  protected override accessToken(): Promise<string> { return Promise.resolve("synthetic-access-token"); }
  protected override postMessage(token: string, raw: string, signal?: AbortSignal): Promise<Response> { this.sent.push({ token, raw, ...(signal ? { signal } : {}) }); return Promise.resolve(this.response.clone()); }
}

async function configuredEnvironment(action: () => Promise<void>): Promise<void> {
  const keys = ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = `synthetic-${key.toLowerCase()}`;
    process.env.GMAIL_SENDER_EMAIL = "sender@example.invalid";
    process.env.CRM_PUBLIC_ORIGIN = "https://crm-dev.example.invalid";
    await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("recovery uses the real OAuth/Gaxios POST merge with retry zero even for TimeoutError, without contacting Google", async () => {
  await configuredEnvironment(async () => {
    const controller = new AbortController();
    class TransportSender extends GmailInvitationSender {
      attempts = 0;
      retry: number | undefined;
      method: string | undefined;
      observedSignal: AbortSignal | undefined;
      protected override createClient(signal?: AbortSignal): OAuth2Client {
        const client = super.createClient(signal);
        client.transporter.defaults.adapter = (options): Promise<never> => {
          this.attempts++; this.retry = options.retryConfig?.retry; this.method = options.method;
          assert.equal(options.signal, signal);
          this.observedSignal = signal;
          const failure = new DOMException("synthetic OAuth timeout", "TimeoutError");
          controller.abort(failure);
          return Promise.reject(failure);
        };
        return client;
      }
      inspectDefault(): OAuth2Client { return super.createClient(); }
      protected override postMessage(): Promise<Response> { assert.fail("Gmail must not be called after OAuth timeout"); }
    }
    const sender = new TransportSender();
    assert.equal(sender.inspectDefault().transporter.defaults.retryConfig, undefined, "default invitation transport is unchanged");
    await assert.rejects(sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/access-recovery/complete#token=synthetic-token", purpose: "RECOVERY", signal: controller.signal }), (error: Error) => error.message === "gmail_send_unconfirmed");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    assert.equal(sender.attempts, 1);
    assert.equal(sender.retry, 0);
    assert.equal(sender.method, "POST");
    assert.equal(sender.observedSignal, controller.signal);
  });
});

test("recovery deadline bounds pending OAuth, send and JSON stages and removes abort listeners", async () => {
  await configuredEnvironment(async () => {
    for (const stage of ["OAUTH", "SEND", "JSON"] as const) {
      const controller = new AbortController();
      let added = 0, removed = 0;
      const originalAdd = controller.signal.addEventListener.bind(controller.signal), originalRemove = controller.signal.removeEventListener.bind(controller.signal);
      controller.signal.addEventListener = (...args: Parameters<AbortSignal["addEventListener"]>): void => { added++; originalAdd(...args); };
      controller.signal.removeEventListener = (...args: Parameters<AbortSignal["removeEventListener"]>): void => { removed++; originalRemove(...args); };
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => { finish = resolve; });
      class PendingSender extends FakeSender {
        protected override async accessToken(): Promise<string> { if (stage === "OAUTH") await pending; return "synthetic-access-token"; }
        protected override async postMessage(): Promise<Response> {
          if (stage === "SEND") await pending;
          if (stage !== "JSON") return Response.json({ id: "synthetic-message" });
          return { ok: true, json: async (): Promise<{ id: string }> => { await pending; return { id: "synthetic-message" }; } } as Response;
        }
      }
      const started = Date.now();
      const operation = new PendingSender().send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/access-recovery/complete#token=synthetic-token", purpose: "RECOVERY", signal: controller.signal });
      const timer = setTimeout(() => controller.abort(new DOMException("synthetic timeout", "TimeoutError")), 15);
      try { await assert.rejects(operation, (error: Error) => error.message === "gmail_send_unconfirmed"); }
      finally { clearTimeout(timer); finish!(); }
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(Date.now() - started < 500, `${stage} must not await a non-terminating transport/body`);
      assert.equal(added, removed, "settled stage listeners are cleaned up");
    }
  });
});

test("Gmail sender reports acceptance only after a message ID and never exposes provider failures", async () => {
  const old = Object.fromEntries(["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"].map((key) => [key, process.env[key]]));
  try {
    process.env.GMAIL_OAUTH_CLIENT_ID = "synthetic-client";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "synthetic-secret";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "synthetic-refresh";
    process.env.GMAIL_SENDER_EMAIL = "sender@example.invalid";
    process.env.CRM_PUBLIC_ORIGIN = "https://crm-dev.example.invalid";
    const sender = new FakeSender();
    assert.equal(sender.configured(), true);
    assert.equal(sender.publicOrigin(), "https://crm-dev.example.invalid");
    await sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/invitation#code=synthetic-code" });
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]?.token, "synthetic-access-token");
    const message = Buffer.from(sender.sent[0].raw, "base64url").toString("utf8");
    assert.match(message, /To: recipient@example\.invalid/u);
    assert.match(message, /#code=synthetic-code/u);
    assert.match(message, /Subject: Votre acces CRM Ynov/u);
    const signal = new AbortController().signal;
    await sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/access-recovery/complete#token=synthetic-token", purpose: "RECOVERY", signal });
    const recoveryMessage = Buffer.from(sender.sent[1]!.raw, "base64url").toString("utf8");
    assert.match(recoveryMessage, /Subject: Recuperer votre acces CRM Ynov/u);
    assert.match(recoveryMessage, /Pour remplacer votre mot de passe/u);
    assert.match(recoveryMessage, /#token=synthetic-token/u);
    assert.equal(sender.sent[1]!.signal, signal);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/access-recovery/complete#token=synthetic-token", purpose: "RECOVERY", signal: aborted.signal }), /gmail_send_unconfirmed/u);
    assert.equal(sender.sent.length, 2);
    sender.response = Response.json({ id: null });
    await assert.rejects(sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/invitation#code=synthetic-code" }), /gmail_send_unconfirmed/u);
    sender.response = Response.json({ error: "private provider response" }, { status: 503 });
    await assert.rejects(sender.send({ recipient: "recipient@example.invalid", link: "https://crm-dev.example.invalid/invitation#code=synthetic-code" }), (error: Error) => error.message === "gmail_send_unconfirmed" && !error.message.includes("private"));
    await assert.rejects(sender.send({ recipient: "invalid\r\nBcc:other@example.invalid", link: "https://crm-dev.example.invalid" }), /invitation_address_invalid/u);
    process.env.CRM_PUBLIC_ORIGIN = "http://crm-dev.example.invalid";
    assert.throws(() => sender.publicOrigin(), /invitation_origin_invalid/u);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
