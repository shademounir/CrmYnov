import { PrismaClient, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { BusinessMailType } from "./business-mail-policy.js";
import { canonicalMailRecipients, type MailRecipientSnapshot } from "./business-mail-evidence.js";

export interface MailJournalInput {
  key: string; eventType: BusinessMailType; resourceId: string; templateVersion: string;
  fingerprint: string; recipientSnapshots: readonly MailRecipientSnapshot[];
  /** Current durable configuration read under the caller's permission/config fence. */
  limits: MailSendingLimits;
}
export interface MailSendingLimits { messagesPerHour: number; messagesPerDay: number; recipientsPerHour: number; recipientsPerDay: number; warningIntervalHours: number }
export type MailSendingReservation = { reserved: true; token: string } | { reserved: false; state: MailJournalState }
  | { reserved: false; reason: "GLOBAL_BUDGET_REACHED" | "WARNING_CADENCE_HELD" };
export type MailJournalState = "SENDING" | "ACCEPTED" | "UNCERTAIN";
export type MailUncertaintyCode = "TRANSPORT_UNCONFIRMED" | "PROCESS_INTERRUPTED" | "ACCEPTANCE_COMMIT_UNCONFIRMED";
interface JournalRow { key: string; status: MailJournalState; fingerprint: string; event_type: string; resource_id: string; template_version: string; recipient_user_ids: MailRecipientSnapshot[] }
const events = new Set(["FOLLOW_UP_DUE", "FOLLOW_UP_OVERDUE", "FIRST_TREATMENT_OVERDUE", "CONFIRMATION_EXPECTED", "RETURN_EXPECTED"]);

/** Dedicated root client: SENDING must commit independently BEFORE any provider call.
 * Not injectable into an authorization transaction, not registered in the application.
 * This journal does not authorize recipients, send mail, or resolve current business facts. */
export class BusinessMailJournal {
  private readonly client = new PrismaClient();

  async reserveSending(input: MailJournalInput): Promise<MailSendingReservation> {
    if (!/^[a-f0-9]{64}$/.test(input.key) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !events.has(input.eventType)
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.resourceId) || !/^[a-zA-Z0-9_-]{1,24}$/.test(input.templateVersion)) throw new Error("business_mail_journal_input_invalid");
    const token = randomUUID(), recipients = canonicalMailRecipients(input.recipientSnapshots);
    const limits = input.limits;
    if (!limits || ![limits.messagesPerHour, limits.messagesPerDay, limits.recipientsPerHour, limits.recipientsPerDay, limits.warningIntervalHours].every(value => Number.isSafeInteger(value) && value >= 1)
      || limits.messagesPerHour > 1000 || limits.messagesPerDay > 24000 || limits.recipientsPerHour > 10000 || limits.recipientsPerDay > 240000
      || limits.messagesPerHour > limits.messagesPerDay || limits.recipientsPerHour > limits.recipientsPerDay || limits.warningIntervalHours > 720) throw new Error("business_mail_budget_invalid");
    return this.client.$transaction(async tx => {
      // Independent journal transaction only. Never reacquire an outer-held Lead,
      // permission or configuration lock. One global fence serializes reservations.
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(174,149)`;
      const existing = await tx.$queryRaw<JournalRow[]>`SELECT key,status,fingerprint,event_type,resource_id,template_version,recipient_user_ids FROM business_mail_deliveries WHERE key=${input.key}`;
      if (existing[0]) return this.replay(existing[0], input, recipients);
      const reason = await this.quotaHold(tx, input);
      if (reason) return { reserved: false as const, reason };
      const inserted = await tx.$queryRaw<Array<{ key: string }>>`INSERT INTO business_mail_deliveries
        (key,event_type,resource_id,template_version,fingerprint,recipient_user_ids,sending_token)
        VALUES (${input.key},${input.eventType},${input.resourceId},${input.templateVersion},${input.fingerprint},${recipients}::jsonb,${token}::uuid)
        ON CONFLICT (key) DO NOTHING RETURNING key`;
      if (inserted.length === 1) return { reserved: true as const, token };
      const rows = await tx.$queryRaw<JournalRow[]>`SELECT key,status,fingerprint,event_type,resource_id,template_version,recipient_user_ids FROM business_mail_deliveries WHERE key=${input.key}`;
      if (!rows[0]) throw new Error("business_mail_journal_key_conflict");
      return this.replay(rows[0], input, recipients);
    }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 });
  }

  private async quotaHold(tx: Prisma.TransactionClient, input: MailJournalInput): Promise<"GLOBAL_BUDGET_REACHED" | "WARNING_CADENCE_HELD" | null> {
    const limits = input.limits;
    const totals = await tx.$queryRaw<Array<{ hour_messages: bigint; day_messages: bigint; hour_recipients: bigint; day_recipients: bigint }>>`
      SELECT count(*) FILTER (WHERE sending_at >= to_timestamp(floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)*3600)) AS hour_messages,
        count(*) AS day_messages,
        COALESCE(sum(jsonb_array_length(recipient_user_ids)) FILTER (WHERE sending_at >= to_timestamp(floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)*3600)),0)::bigint AS hour_recipients,
        COALESCE(sum(jsonb_array_length(recipient_user_ids)),0)::bigint AS day_recipients
      FROM business_mail_deliveries WHERE sending_at >= to_timestamp(floor(extract(epoch FROM CURRENT_TIMESTAMP)/86400)*86400)`;
    const total = totals[0]!;
    if (total.hour_messages >= BigInt(limits.messagesPerHour) || total.day_messages >= BigInt(limits.messagesPerDay)
      || total.hour_recipients + BigInt(input.recipientSnapshots.length) > BigInt(limits.recipientsPerHour)
      || total.day_recipients + BigInt(input.recipientSnapshots.length) > BigInt(limits.recipientsPerDay)) return "GLOBAL_BUDGET_REACHED";
    if (input.eventType === "FOLLOW_UP_OVERDUE") {
      const recent = await tx.$queryRaw<Array<{ key: string }>>`SELECT key FROM business_mail_deliveries
        WHERE resource_id=${input.resourceId} AND event_type IN ('FOLLOW_UP_DUE','FOLLOW_UP_OVERDUE')
        AND sending_at > CURRENT_TIMESTAMP - (${limits.warningIntervalHours} * INTERVAL '1 hour') LIMIT 1`;
      if (recent.length) return "WARNING_CADENCE_HELD";
    }
    return null;
  }

  private replay(row: JournalRow, input: MailJournalInput, recipients: string): { reserved: false; state: MailJournalState } {
    if (row.fingerprint !== input.fingerprint || row.event_type !== input.eventType || row.resource_id !== input.resourceId
      || row.template_version !== input.templateVersion || canonicalMailRecipients(row.recipient_user_ids) !== recipients) throw new Error("business_mail_journal_key_conflict");
    return { reserved: false, state: row.status };
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
