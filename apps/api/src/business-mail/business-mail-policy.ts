import { createHash } from "node:crypto";

export const BUSINESS_MAIL_TEMPLATE_VERSION = "fr-v1";
export type BusinessMailType = "FOLLOW_UP_DUE" | "FOLLOW_UP_OVERDUE" | "FIRST_TREATMENT_OVERDUE" | "CONFIRMATION_EXPECTED" | "RETURN_EXPECTED";
const types = new Set<BusinessMailType>(["FOLLOW_UP_DUE", "FOLLOW_UP_OVERDUE", "FIRST_TREATMENT_OVERDUE", "CONFIRMATION_EXPECTED", "RETURN_EXPECTED"]);
export interface MailScope { campusId: string; campaignId: string | null }
export interface InternalMailMember {
  userId: string; email: string; active: boolean; hasLeadAccess: boolean;
  /** Explicit CRM membership, not an assignment candidate or a campus-wide fallback. */
  memberships: readonly MailScope[];
}
export interface BusinessMailFacts {
  type: BusinessMailType; resourceId: string; leadReference: string; scope: MailScope;
  leadState: string; acquisition: "NEW" | "BASELINE"; state: string;
  /** Persisted task OWNER or current designated Admissions responsible, resolved by the server. */
  actionOwnerId: string; deadline: Date | null; receivedAt: Date | null;
  lastTreatmentAt: Date | null; reportPresent: boolean; bookingState: string | null;
}
export interface BusinessMailPolicy {
  enabled: boolean; activatedAt: Date | null; generatedAt: Date;
  /** Fixed intervals anchored to the persisted deadline, never to worker restart time. */
  warningCadenceHours: number; maximumWarnings: number;
}
export interface PreparedBusinessMail {
  type: BusinessMailType; key: string; templateVersion: typeof BUSINESS_MAIL_TEMPLATE_VERSION;
  leadReference: string; deadline: string; generatedAt: string; occurrence: number;
  to: string; cc: string[]; recipientUserIds: string[];
}
export type BusinessMailPreparation = { status: "HELD"; reason: string } | { status: "PREPARED"; message: PreparedBusinessMail };
const held = (reason: string): BusinessMailPreparation => ({ status: "HELD", reason });
const validDate = (value: Date | null): value is Date => value instanceof Date && Number.isFinite(value.valueOf());
const identifier = (value: string): boolean => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const email = (value: string): boolean => typeof value === "string" && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
const sameScope = (a: MailScope, b: MailScope): boolean => a.campusId === b.campusId && a.campaignId === b.campaignId;

/** Pure preparation over server-resolved facts. NOT a permission check, journal, dispatcher or activation API.
 * A future adapter must re-read permissions and business state transactionally before emission. */
export function prepareBusinessMail(facts: BusinessMailFacts, policy: BusinessMailPolicy, members: readonly InternalMailMember[]): BusinessMailPreparation {
  if (!policy.enabled) return held("DISABLED");
  if (!validDate(policy.generatedAt) || !validDate(policy.activatedAt) || policy.generatedAt < policy.activatedAt) return held("ACTIVATION_BASELINE_REQUIRED");
  if (!types.has(facts.type) || !identifier(facts.resourceId) || !/^LD-[A-Z0-9-]{1,40}$/.test(facts.leadReference)
    || !identifier(facts.scope.campusId) || (facts.scope.campaignId !== null && !identifier(facts.scope.campaignId)) || !identifier(facts.actionOwnerId)) return held("INVALID_FACTS");
  if (facts.leadState !== "OPEN") return held("LEAD_NOT_OPEN");
  let deadline = facts.deadline;
  if (facts.type === "FIRST_TREATMENT_OVERDUE") {
    if (facts.acquisition !== "NEW" || facts.lastTreatmentAt !== null || !validDate(facts.receivedAt)) return held("FIRST_TREATMENT_NOT_APPLICABLE");
    deadline = new Date(facts.receivedAt.valueOf() + 24 * 3_600_000);
  }
  if (!validDate(deadline)) return held("PERSISTED_DEADLINE_REQUIRED");
  if (deadline < policy.activatedAt) return held("HISTORICAL_BACKLOG_REQUIRES_SEPARATE_WAVE");
  const delta = policy.generatedAt.valueOf() - deadline.valueOf();
  if (delta < 0 || (delta === 0 && (facts.type === "FIRST_TREATMENT_OVERDUE" || facts.type === "FOLLOW_UP_OVERDUE"))) return held("NOT_DUE");
  if ((facts.type === "FOLLOW_UP_DUE" || facts.type === "FOLLOW_UP_OVERDUE") && !["SCHEDULED", "DUE"].includes(facts.state)) return held("FOLLOW_UP_NOT_ACTIVE");
  if (facts.type === "CONFIRMATION_EXPECTED" && facts.state !== "PENDING") return held("CONFIRMATION_NOT_EXPECTED");
  if (facts.type === "RETURN_EXPECTED" && (facts.bookingState !== "ACCEPTED" || facts.state !== "CONFIRME" || facts.reportPresent)) return held("RETURN_NOT_EXPECTED");
  let occurrence = 0;
  if (facts.type === "FOLLOW_UP_OVERDUE") {
    if (!Number.isSafeInteger(policy.warningCadenceHours) || policy.warningCadenceHours < 1 || policy.warningCadenceHours > 720
      || !Number.isSafeInteger(policy.maximumWarnings) || policy.maximumWarnings < 1 || policy.maximumWarnings > 30) return held("INVALID_WARNING_POLICY");
    occurrence = Math.floor(delta / (policy.warningCadenceHours * 3_600_000));
    if (occurrence === 0) return held("WARNING_NOT_DUE");
    if (occurrence > policy.maximumWarnings) return held("WARNING_LIMIT_REACHED");
  }
  const eligible = members.filter(member => member.active && member.hasLeadAccess && member.memberships.some(scope => sameScope(scope, facts.scope)));
  const owner = eligible.filter(member => member.userId === facts.actionOwnerId);
  if (owner.length !== 1 || !email(owner[0]!.email)) return held("ACTION_OWNER_UNAVAILABLE");
  // Reject ambiguous identities instead of silently collapsing conflicting CRM rows.
  const ids = new Set<string>(); const addresses = new Set<string>();
  for (const member of eligible) {
    if (!identifier(member.userId) || !email(member.email) || ids.has(member.userId) || addresses.has(member.email.toLowerCase())) return held("MEMBERSHIP_AMBIGUOUS");
    ids.add(member.userId); addresses.add(member.email.toLowerCase());
  }
  const copies = eligible.filter(member => member.userId !== facts.actionOwnerId).sort((a, b) => a.userId.localeCompare(b.userId, "en"));
  const key = createHash("sha256").update(JSON.stringify(["business-mail-v1", facts.type, facts.resourceId, deadline.toISOString(), occurrence])).digest("hex");
  // Template or membership changes must not mint a new delivery identity for the same event.
  return { status: "PREPARED", message: { type: facts.type, key, templateVersion: BUSINESS_MAIL_TEMPLATE_VERSION, leadReference: facts.leadReference,
    deadline: deadline.toISOString(), generatedAt: policy.generatedAt.toISOString(), occurrence, to: owner[0]!.email,
    cc: copies.map(member => member.email), recipientUserIds: [facts.actionOwnerId, ...copies.map(member => member.userId)] } };
}
