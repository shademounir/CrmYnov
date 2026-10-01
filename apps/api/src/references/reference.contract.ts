import { BadRequestException } from "@nestjs/common";

export const referenceKinds = ["CAMPUS", "PROGRAM", "SCHOLARSHIP", "CAMPAIGN", "TAG"] as const;
export type ReferenceKind = typeof referenceKinds[number];
export type ReferenceScope = "GLOBAL" | "CAMPUS";
export interface ReferenceInput { kind: ReferenceKind; code: string; label: string; scope: ReferenceScope; campusId: string | null; aliases?: string[] }
export interface ReferenceUpdate { label?: string; state?: "ACTIVE" | "ARCHIVED"; scope?: ReferenceScope; campusId?: string | null; aliases?: string[]; expectedVersion: number }
export interface TagAssignment { tagIds: string[]; expectedVersion: number; idempotencyKey: string }
export const referenceFields = { campus: "CAMPUS", program: "PROGRAM", campaign: "CAMPAIGN" } as const;
export type LeadReferenceValues = { campus: string; program: string; campaign: string };
export function referenceKey(value: string): string { return value.trim().normalize("NFC").toLocaleUpperCase("fr"); }
export function referenceText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || !/^[\p{L}\p{N} .,%'’()_/-]+$/u.test(value)) throw new BadRequestException({ code: "reference_text_invalid" });
  return value.trim();
}
export function strictBody(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new BadRequestException({ code: "reference_field_forbidden" });
}
export function referenceVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BadRequestException({ code: "reference_version_required" });
}
export function referenceId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) throw new BadRequestException({ code: "reference_id_invalid" });
}
export function validateReferenceInput(input: ReferenceInput): ReferenceInput {
  strictBody(input, ["kind", "code", "label", "scope", "campusId", "aliases"]);
  if (!referenceKinds.includes(input.kind)) throw new BadRequestException({ code: "reference_kind_invalid" });
  // Campus scope identifiers already exist: preserve their case, normalize only lookup keys.
  const code = input.kind === "CAMPUS" ? referenceText(input.code) : referenceKey(referenceText(input.code));
  if (input.kind === "CAMPUS" && code.length > 80) throw new BadRequestException({ code: "reference_text_invalid" });
  if (input.kind === "SCHOLARSHIP" && !["20", "30", "40"].includes(code)) throw new BadRequestException({ code: "scholarship_rate_invalid" });
  validateReferenceScope(input.kind, input.scope, input.campusId);
  validateAliases(input.aliases);
  return { ...input, code, label: referenceText(input.label) };
}
export function validateAliases(aliases: unknown): asserts aliases is string[] | undefined {
  if (aliases === undefined) return;
  if (!Array.isArray(aliases) || aliases.length > 20) throw new BadRequestException({ code: "reference_alias_invalid" });
  aliases.forEach(referenceText);
}
export function validateReferenceScope(kind: string, scope: unknown, campusId: unknown): void {
  if (scope === "GLOBAL" && campusId === null) return;
  if (scope !== "CAMPUS" || !["CAMPAIGN", "TAG"].includes(kind)) throw new BadRequestException({ code: "reference_scope_invalid" });
  referenceId(campusId);
}
