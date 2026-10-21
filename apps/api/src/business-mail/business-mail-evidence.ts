import { createHash } from "node:crypto";
import type { PreparedBusinessMail, MailScope } from "./business-mail-policy.js";
import { renderBusinessMail } from "./business-mail-template.js";

/** Versioned ordered tuples avoid JSONB object-key ordering and retain historical
 * identities, addresses and exact scope. The legacy SQL column name is preserved.
 */
export type MailRecipientSnapshot = readonly [1, string, string, "TO" | "CC", string, string | null];
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const email = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
export function canonicalMailRecipients(rows: readonly MailRecipientSnapshot[]): string {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) throw new Error("business_mail_recipient_evidence_invalid");
  const ids = new Set<string>(), addresses = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== 6 || row[0] !== 1 || !identifier(row[1]) || !email(row[2])
      || row[3] !== (index === 0 ? "TO" : "CC") || !identifier(row[4]) || (row[5] !== null && !identifier(row[5]))
      || ids.has(row[1]) || addresses.has(row[2].toLowerCase()) || row[4] !== rows[0]![4] || row[5] !== rows[0]![5]) throw new Error("business_mail_recipient_evidence_invalid");
    ids.add(row[1]); addresses.add(row[2].toLowerCase());
  }
  return JSON.stringify(rows);
}
/** Evidence only, not authorization. Build under current business/permission fences. */
export function businessMailEvidence(message: PreparedBusinessMail, scope: MailScope, origin: string): { fingerprint: string; recipientSnapshots: MailRecipientSnapshot[] } {
  const addresses = [message.to, ...message.cc];
  if (addresses.length !== message.recipientUserIds.length) throw new Error("business_mail_recipient_evidence_invalid");
  const recipientSnapshots: MailRecipientSnapshot[] = addresses.map((address, index) =>
    [1, message.recipientUserIds[index]!, address, index === 0 ? "TO" : "CC", scope.campusId, scope.campaignId]);
  canonicalMailRecipients(recipientSnapshots);
  const content = renderBusinessMail(message, origin);
  return { recipientSnapshots, fingerprint: createHash("sha256").update(JSON.stringify(["business-mail-evidence-v1", message, recipientSnapshots, content])).digest("hex") };
}
