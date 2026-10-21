import { OAuth2Client } from "google-auth-library";
import { renderBusinessMail } from "./business-mail-template.js";
import type { PreparedBusinessMail } from "./business-mail-policy.js";

const address = (value: string): boolean => typeof value === "string" && value.length <= 254
  && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
const base64Body = (value: string): string => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)!.join("\r\n");
function encodedSubject(value: string): string {
  const words: string[] = []; let part = "";
  for (const character of value) {
    if (Buffer.byteLength(part + character, "utf8") > 42) { words.push(part); part = ""; }
    part += character;
  }
  if (part) words.push(part);
  return words.map(word => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** Bounds OAuth, POST and body parsing, including transports which ignore cancellation. */
function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true; signal.removeEventListener("abort", aborted); return true;
    };
    const aborted = (): void => { if (finish()) reject(new Error("business_mail_send_unconfirmed")); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    operation.then(value => {
      if (signal.aborted) aborted(); else if (finish()) resolve(value);
    }, () => { if (finish()) reject(new Error("business_mail_send_unconfirmed")); });
  });
}

/** Transport primitive ONLY. Not registered in AppModule or a worker.
 * The caller MUST hold current authorization/closure fences and a committed SENDING
 * reservation before calling. No invitation/recovery path or generic retry is used.
 * A failure is uncertain, never evidence that a second emission is safe. */
export class GmailBusinessMailSender {
  configured(): boolean {
    return ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"]
      .every(key => Boolean(process.env[key]?.trim()));
  }

  protected createClient(signal: AbortSignal): OAuth2Client {
    // OAuth's refresh POST sets retry:true; retryConfig.retry=0 survives its merge.
    return new OAuth2Client({ clientId: process.env.GMAIL_OAUTH_CLIENT_ID!, clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
      transporterOptions: { signal, retryConfig: { retry: 0 } } });
  }

  protected async accessToken(signal: AbortSignal): Promise<string> {
    const client = this.createClient(signal);
    client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN! });
    const access = await client.getAccessToken();
    if (!access.token) throw new Error("business_mail_send_unconfirmed");
    return access.token;
  }

  protected postMessage(token: string, raw: string, signal: AbortSignal): Promise<Response> {
    return fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }), signal, redirect: "error",
    });
  }

  async sendPrepared(message: PreparedBusinessMail, callerSignal: AbortSignal): Promise<{ providerMessageId: string }> {
    if (!this.configured()) throw new Error("business_mail_transport_unconfigured");
    const from = process.env.GMAIL_SENDER_EMAIL!;
    const recipients = [message.to, ...message.cc];
    if (!address(from) || recipients.length > 100 || recipients.some(value => !address(value))
      || new Set(recipients.map(value => value.toLowerCase())).size !== recipients.length
      || message.recipientUserIds.length !== recipients.length || new Set(message.recipientUserIds).size !== recipients.length
      || message.recipientUserIds.some(id => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
      || !/^[a-f0-9]{64}$/.test(message.key) || message.templateVersion !== "fr-v1") throw new Error("business_mail_transport_input_invalid");
    const content = renderBusinessMail(message, process.env.CRM_PUBLIC_ORIGIN!);
    // Generated content only: no caller-supplied subject/body/header or prospect data.
    const boundary = "crm-business-" + message.key.slice(0, 40);
    const mime = [`From: ${from}`, `To: ${message.to}`, ...(message.cc.length ? [`Cc: ${message.cc.join(",\r\n ")}`] : []),
      `Subject: ${encodedSubject(content.subject)}`, "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Body(content.text),
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Body(content.html), `--${boundary}--`, ""].join("\r\n");
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(15_000)]);
    try {
      signal.throwIfAborted();
      const token = await bounded(this.accessToken(signal), signal);
      signal.throwIfAborted();
      const response = await bounded(this.postMessage(token, Buffer.from(mime, "utf8").toString("base64url"), signal), signal);
      if (!response.ok) throw new Error("business_mail_send_unconfirmed");
      const result = await bounded(response.json(), signal) as { id?: unknown };
      signal.throwIfAborted();
      if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.id)) throw new Error("business_mail_send_unconfirmed");
      return { providerMessageId: result.id };
    } catch {
      // Provider responses/OAuth exceptions may contain credentials or private data.
      throw new Error("business_mail_send_unconfirmed");
    }
  }
}
