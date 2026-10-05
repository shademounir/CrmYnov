import { Injectable } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";

export interface InvitationDelivery { recipient: string; link: string; purpose?: "INVITATION" | "RECOVERY"; signal?: AbortSignal }

/** Bound every delivery stage, including a response body that never completes.
 * The same signal aborts the actual transport; no automatic retry follows it. */
function withinSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", aborted);
      return true;
    };
    const aborted = (): void => { if (cleanup()) reject(new Error("gmail_send_unconfirmed")); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    operation.then((value) => {
      if (signal.aborted) aborted(); else if (cleanup()) resolve(value);
    }, () => {
      if (cleanup()) reject(new Error("gmail_send_unconfirmed"));
    });
  });
}

@Injectable()
export class GmailInvitationSender {
  protected createClient(signal?: AbortSignal): OAuth2Client {
    return signal
      // OAuth supplies retry:true on refresh POST. Its deep-merged retryConfig
      // preserves retry:0, whereas transporterOptions.retry:false is overridden.
      ? new OAuth2Client({ clientId: process.env.GMAIL_OAUTH_CLIENT_ID!, clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!, transporterOptions: { signal, retryConfig: { retry: 0 } } })
      : new OAuth2Client(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
  }

  protected async accessToken(signal?: AbortSignal): Promise<string> {
    const client = this.createClient(signal);
    client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN! });
    const access = await client.getAccessToken();
    if (!access.token) throw new Error("gmail_access_unavailable");
    return access.token;
  }

  protected async postMessage(token: string, raw: string, signal?: AbortSignal): Promise<Response> {
    return fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
  }

  configured(): boolean {
    return ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"].every((key) => Boolean(process.env[key]?.trim()));
  }

  publicOrigin(): string {
    const raw = process.env.CRM_PUBLIC_ORIGIN?.trim();
    if (!raw) throw new Error("invitation_origin_unconfigured");
    const origin = new URL(raw);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password || origin.origin !== raw.replace(/\/$/, "")) throw new Error("invitation_origin_invalid");
    return origin.origin;
  }

  async send({ recipient, link, purpose = "INVITATION", signal }: InvitationDelivery): Promise<void> {
    if (!this.configured()) throw new Error("invitation_transport_unconfigured");
    const from = process.env.GMAIL_SENDER_EMAIL!;
    if (![from, recipient].every((value) => /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value))) throw new Error("invitation_address_invalid");
    try {
      signal?.throwIfAborted();
      const token = await withinSignal(this.accessToken(signal), signal);
      signal?.throwIfAborted();
      const subject = purpose === "RECOVERY" ? "Recuperer votre acces CRM Ynov" : "Votre acces CRM Ynov";
      const instruction = purpose === "RECOVERY" ? "Pour remplacer votre mot de passe, ouvrez ce lien personnel :" : "Pour definir votre mot de passe, ouvrez ce lien personnel :";
      const mime = `From: ${from}\r\nTo: ${recipient}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${instruction}\r\n${link}\r\n\r\nCe lien expire rapidement et ne doit pas etre partage.\r\n`;
      const response = await withinSignal(this.postMessage(token, Buffer.from(mime, "utf8").toString("base64url"), signal), signal);
      if (!response.ok) throw new Error("gmail_send_unconfirmed");
      const result = await withinSignal(response.json(), signal) as { id?: unknown };
      signal?.throwIfAborted();
      if (typeof result.id !== "string" || !result.id) throw new Error("gmail_send_unconfirmed");
    } catch {
      // Never propagate provider bodies or OAuth exceptions: they may contain private data.
      throw new Error("gmail_send_unconfirmed");
    }
  }
}
