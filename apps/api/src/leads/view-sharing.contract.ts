import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

export interface SharingInput { kind: "TEAM" | "CAMPUS"; audienceId: string; expectedVersion: number; idempotencyKey: string }
export interface ViewCommand { expectedVersion: number; idempotencyKey: string }
export interface DuplicateViewInput extends ViewCommand { name: string }
export interface ViewSummary { id: string; name: string; filters: Record<string, string>; version: number; owned: boolean }
export interface ViewDetails extends ViewSummary {
  ownerDisplayName: string; isOwner: boolean;
  visibleAudiences: { type: "TEAM" | "CAMPUS"; label: string }[];
  canEdit: boolean; canRevoke: boolean; canDuplicate: boolean;
}
export interface Audience { kind: "TEAM" | "CAMPUS"; id: string; campusId: string; label: string }
export interface ShareSummary { id: string; viewId: string; kind: string; audienceId: string; active: boolean; version: number; viewVersion: number; canRevoke: boolean }
export function missingView(): never { throw new NotFoundException({ code: "saved_view_not_found" }); }
export function viewConflict(): never { throw new ConflictException({ code: "saved_view_version_conflict" }); }
export function invalidView(): never { throw new BadRequestException({ code: "saved_view_input_invalid" }); }
export function viewId(value: string): string { if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)) missingView(); return value; }
export function command(value: ViewCommand, extra: readonly string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidView();
  if (Object.keys(value).some((key) => !["expectedVersion", "idempotencyKey", ...extra].includes(key))) invalidView();
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) invalidView();
  if (typeof value.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(value.idempotencyKey)) invalidView();
}
export function sharingInput(value: SharingInput): void {
  command(value, ["kind", "audienceId"]);
  if (value.kind !== "TEAM" && value.kind !== "CAMPUS") invalidView();
  if (typeof value.audienceId !== "string") invalidView();
  viewId(value.audienceId);
}
export function viewName(value: string): string {
  if (typeof value !== "string") invalidView();
  const result = value.trim();
  if (!result || result.length > 80 || !/^[\p{L}\p{N} .,'()_-]+$/u.test(result)) invalidView();
  return result;
}
export function storedFilters(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidView();
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) invalidView();
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}
export function correlation(value: string): string {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : "view-sharing-request";
}
