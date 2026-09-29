import { Injectable } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";

export interface InvitationDelivery { recipient: string; link: string }

@Injectable()
export class GmailInvitationSender {
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

  async send({ recipient, link }: InvitationDelivery): Promise<void> {
    if (!this.configured()) throw new Error("invitation_transport_unconfigured");
    const from = process.env.GMAIL_SENDER_EMAIL!;
    if (![from, recipient].every((value) => /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value))) throw new Error("invitation_address_invalid");
    const client = new OAuth2Client(process.env.GMAIL_OAUTH_CLIENT_ID, process.env.GMAIL_OAUTH_CLIENT_SECRET);
    client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN! });
    try {
      const access = await client.getAccessToken();
      if (!access.token) throw new Error("gmail_access_unavailable");
      const mime = `From: ${from}\r\nTo: ${recipient}\r\nSubject: Votre acces CRM Ynov\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nPour definir votre mot de passe, ouvrez ce lien personnel :\r\n${link}\r\n\r\nCe lien expire rapidement et ne doit pas etre partage.\r\n`;
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("gmail_send_unconfirmed");
      const result = await response.json() as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) throw new Error("gmail_send_unconfirmed");
    } catch {
      // Never propagate provider bodies or OAuth exceptions: they may contain private data.
      throw new Error("gmail_send_unconfirmed");
    }
  }
}
