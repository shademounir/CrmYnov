import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { BusinessMailType } from "./business-mail-policy.js";
import { canonicalMailRecipients, type MailRecipientSnapshot } from "./business-mail-evidence.js";

export interface MailJournalInput {
  key: string; eventType: BusinessMailType; resourceId: string; templateVersion: string;
  fingerprint: string; recipientSnapshots: readonly MailRecipientSnapshot[];
}
export type MailJournalState = "SENDING" | "ACCEPTED" | "UNCERTAIN";
export type MailUncertaintyCode = "TRANSPORT_UNCONFIRMED" | "PROCESS_INTERRUPTED" | "ACCEPTANCE_COMMIT_UNCONFIRMED";
interface JournalRow { key: string; status: MailJournalState; fingerprint: string; event_type: string; resource_id: string; template_version: string; recipient_user_ids: MailRecipientSnapshot[] }
const events = new Set(["FOLLOW_UP_DUE", "FOLLOW_UP_OVERDUE", "FIRST_TREATMENT_OVERDUE", "CONFIRMATION_EXPECTED", "RETURN_EXPECTED"]);

/** Dedicated root client: SENDING must commit independently BEFORE any provider call.
 * Not injectable into an authorization transaction, not registered in the application.
 * This journal does not authorize recipients, send mail, or resolve current business facts. */
export class BusinessMailJournal {
  private readonly client = new PrismaClient();

  async reserveSending(input: MailJournalInput): Promise<{ reserved: true; token: string } | { reserved: false; state: MailJournalState }> {
    if (!/^[a-f0-9]{64}$/.test(input.key) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !events.has(input.eventType)
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.resourceId) || !/^[a-zA-Z0-9_-]{1,24}$/.test(input.templateVersion)) throw new Error("business_mail_journal_input_invalid");
    const token = randomUUID(), recipients = canonicalMailRecipients(input.recipientSnapshots);
    return this.client.$transaction(async tx => {
      const inserted = await tx.$queryRaw<Array<{ key: string }>>`INSERT INTO business_mail_deliveries
        (key,event_type,resource_id,template_version,fingerprint,recipient_user_ids,sending_token)
        VALUES (${input.key},${input.eventType},${input.resourceId},${input.templateVersion},${input.fingerprint},${recipients}::jsonb,${token}::uuid)
        ON CONFLICT (key) DO NOTHING RETURNING key`;
      if (inserted.length === 1) return { reserved: true as const, token };
      const rows = await tx.$queryRaw<JournalRow[]>`SELECT key,status,fingerprint,event_type,resource_id,template_version,recipient_user_ids FROM business_mail_deliveries WHERE key=${input.key}`;
      const row = rows[0];
      if (!row || row.fingerprint !== input.fingerprint || row.event_type !== input.eventType || row.resource_id !== input.resourceId
        || row.template_version !== input.templateVersion || JSON.stringify(row.recipient_user_ids) !== recipients) throw new Error("business_mail_journal_key_conflict");
      return { reserved: false as const, state: row.status };
    }, { isolationLevel: "ReadCommitted" });
  }

  async accepted(key: string, token: string, providerMessageId: string): Promise<boolean> {
    this.validateIdentity(key, token);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(providerMessageId)) throw new Error("business_mail_provider_id_invalid");
    const updated = await this.client.$executeRaw`UPDATE business_mail_deliveries SET status='ACCEPTED',accepted_at=clock_timestamp(),provider_message_id=${providerMessageId}
      WHERE key=${key} AND sending_token=${token}::uuid AND status='SENDING'`;
    return updated === 1;
  }

  async uncertain(key: string, token: string, code: MailUncertaintyCode): Promise<boolean> {
    this.validateIdentity(key, token);
    if (!["TRANSPORT_UNCONFIRMED", "PROCESS_INTERRUPTED", "ACCEPTANCE_COMMIT_UNCONFIRMED"].includes(code)) throw new Error("business_mail_uncertainty_code_invalid");
    const updated = await this.client.$executeRaw`UPDATE business_mail_deliveries SET status='UNCERTAIN',uncertain_at=clock_timestamp(),uncertainty_code=${code}
      WHERE key=${key} AND sending_token=${token}::uuid AND status='SENDING'`;
    return updated === 1;
  }

  /** Interrupted SENDING is retained as UNCERTAIN, never reclaimed for another emission. */
  async retainInterrupted(olderThan: Date, limit = 100): Promise<number> {
    if (!(olderThan instanceof Date) || !Number.isFinite(olderThan.valueOf()) || olderThan.valueOf() > Date.now() || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("business_mail_recovery_invalid");
    return this.client.$executeRaw`WITH interrupted AS (
      SELECT key FROM business_mail_deliveries WHERE status='SENDING' AND sending_at < ${olderThan}
      ORDER BY sending_at,key LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) UPDATE business_mail_deliveries d SET status='UNCERTAIN',uncertain_at=clock_timestamp(),uncertainty_code='PROCESS_INTERRUPTED'
      FROM interrupted i WHERE d.key=i.key AND d.status='SENDING'`;
  }

  async close(): Promise<void> { await this.client.$disconnect(); }
  private validateIdentity(key: string, token: string): void {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) throw new Error("business_mail_journal_identity_invalid");
  }
}
