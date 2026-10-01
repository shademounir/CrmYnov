import assert from "node:assert/strict";
import test from "node:test";
import { GmailInvitationSender } from "../src/invitations/gmail-invitation.sender.js";

class FakeSender extends GmailInvitationSender {
  sent: Array<{ token: string; raw: string }> = [];
  response: Response = Response.json({ id: "synthetic-gmail-message" });
  protected override accessToken(): Promise<string> { return Promise.resolve("synthetic-access-token"); }
  protected override postMessage(token: string, raw: string): Promise<Response> { this.sent.push({ token, raw }); return Promise.resolve(this.response); }
}

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
