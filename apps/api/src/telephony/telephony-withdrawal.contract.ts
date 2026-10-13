import { createHash } from "node:crypto";

export interface WithdrawalRequest {
  requestId: string;
  associationId: string;
  workstationId: string;
  profileId: string;
}

export interface WithdrawalReceipt extends WithdrawalRequest {
  schemaVersion: 1;
  outcome: "WITHDRAWN";
  withdrawnAt: string;
  workstationVersion: number;
  profileVersion: number;
}

const requestFields = ["requestId", "associationId", "workstationId", "profileId"] as const;
const receiptFields = [...requestFields, "schemaVersion", "outcome", "withdrawnAt", "workstationVersion", "profileVersion"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(input: unknown, fields: readonly string[]): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    && Object.keys(input).length === fields.length && fields.every((key) => Object.hasOwn(input, key));
}

/** No coercion, defaults, or ignored fields at this destructive-action boundary. */
export function parseWithdrawalRequest(input: unknown): WithdrawalRequest | null {
  if (!record(input, requestFields) || !requestFields.every((key) => typeof input[key] === "string" && uuid.test(input[key]))) return null;
  return {
    requestId: String(input.requestId).toLowerCase(), associationId: String(input.associationId).toLowerCase(),
    workstationId: String(input.workstationId).toLowerCase(), profileId: String(input.profileId).toLowerCase(),
  };
}

export function isWithdrawalToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(token);
}

/** Server-computed lookup commitment, never accepted as a credential or returned in a DTO. */
export function withdrawalReceiptKey(rawToken: string, request: WithdrawalRequest): string {
  const commitment = createHash("sha256").update(JSON.stringify([
    "crm-ynov:telephony-profile-withdrawal:receipt:v1", rawToken,
    request.requestId, request.associationId, request.workstationId, request.profileId,
  ])).digest("hex");
  return `telephony-withdrawal:v1:${commitment}`;
}

/** Only this versioned event payload can prove a withdrawal; old revoke audits cannot. */
export function parseWithdrawalReceipt(input: unknown, expected: WithdrawalRequest): WithdrawalReceipt | null {
  if (!record(input, receiptFields) || input.schemaVersion !== 1 || input.outcome !== "WITHDRAWN") return null;
  if (!requestFields.every((key) => input[key] === expected[key] && uuid.test(expected[key]))) return null;
  if (typeof input.withdrawnAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.withdrawnAt)
    || !Number.isFinite(Date.parse(input.withdrawnAt)) || new Date(input.withdrawnAt).toISOString() !== input.withdrawnAt) return null;
  if (typeof input.workstationVersion !== "number" || !Number.isSafeInteger(input.workstationVersion) || input.workstationVersion < 2
    || typeof input.profileVersion !== "number" || !Number.isSafeInteger(input.profileVersion) || input.profileVersion < 2) return null;
  return { ...expected, schemaVersion: 1, outcome: "WITHDRAWN", withdrawnAt: input.withdrawnAt,
    workstationVersion: input.workstationVersion, profileVersion: input.profileVersion };
}
