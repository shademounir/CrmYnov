import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export interface ResponsibilityView { id: string; userId: string; label: string; campus: string; campusLabel: string; active: boolean; version: number }
export interface WindowView { id: string; responsibilityId: string; campus: string; kind: "AVAILABLE" | "BLOCKED"; startsAt: string; endsAt: string; version: number; active: boolean }
export interface BookingView {
  id: string; leadId: string; leadIdentifier: string; leadLabel: string; responsibilityId: string;
  responsibleId: string; responsibleLabel: string; requesterId: string; campus: string; campusLabel: string; type: string; mode: string;
  state: "PENDING" | "ACCEPTED" | "REFUSED" | "CANCELLED"; appointmentState: string;
  startsAt: string; endsAt: string; durationMinutes: number; version: number;
  canDecide: boolean; canCancel: boolean; canReschedule: boolean; canComplete: boolean; canNoShow: boolean; canWriteReport: boolean; reportResult?: string;
}
export interface ResponsibilityInput { userId: string; campus: string; active: boolean; expectedVersion: number; idempotencyKey: string }
export interface WindowInput { responsibilityId: string; kind: "AVAILABLE" | "BLOCKED"; startsAt: string; endsAt: string; idempotencyKey: string }
export interface WithdrawWindowInput { active: false; expectedVersion: number; idempotencyKey: string }
export interface BookingInput { responsibilityId: string; startsAt: string; durationMinutes: number; type: string; mode: string; participantIds?: string[]; idempotencyKey: string }
export interface BookingDecisionInput { action: "ACCEPT" | "REFUSE" | "CANCEL" | "RESCHEDULE" | "COMPLETE" | "NO_SHOW"; reason?: string; startsAt?: string; expectedVersion: number; idempotencyKey: string }
export interface AdmissionsReportInput { expectedVersion: number; idempotencyKey: string; result: string; comment: string; recommendation: string; missingPoints?: string; nextAction?: string; followUpAt?: string }

export function invalidAdmissions(): never { throw new BadRequestException({ code: "admissions_invalid" }); }
export function assertUuid(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) invalidAdmissions(); }
export function assertKey(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalidAdmissions(); }
export function instant(value: unknown): Date { if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/u.test(value)) invalidAdmissions(); const parsed = new Date(value); if (!Number.isFinite(parsed.valueOf())) invalidAdmissions(); return parsed; }
export function interval(from: unknown, to: unknown, maxDays: number): { from: Date; to: Date } { const start = instant(from); const end = instant(to); if (end <= start || end.valueOf() - start.valueOf() > maxDays * 86_400_000) invalidAdmissions(); return { from: start, to: end }; }
export function assertVersion(value: unknown, allowZero = false): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) invalidAdmissions(); }
export function assertDuration(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < 15 || Number(value) > 480) invalidAdmissions(); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, canonical(item)])); return value; }
export function hashAdmissions(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function strictInput(value: unknown, fields: readonly string[]): void { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) invalidAdmissions(); }

/** The commercial never receives busy details. These half-open intervals are only used server-side. */
export function freeSlots(available: readonly { startsAt: Date; endsAt: Date }[], occupied: readonly { startsAt: Date; endsAt: Date }[], from: Date, to: Date, duration: number, now = new Date()): Array<{ startsAt: string; endsAt: string }> {
  const result = new Map<string, { startsAt: string; endsAt: string }>();
  for (const window of available) {
    const earliest = Math.max(window.startsAt.valueOf(), from.valueOf(), now.valueOf() + 1);
    const step = 15 * 60_000;
    let start = window.startsAt.valueOf() + Math.ceil((earliest - window.startsAt.valueOf()) / step) * step;
    const latest = Math.min(window.endsAt.valueOf(), to.valueOf());
    for (; start + duration * 60_000 <= latest; start += step) {
      const end = start + duration * 60_000;
      if (!occupied.some((item) => item.startsAt.valueOf() < end && item.endsAt.valueOf() > start)) {
        const startsAt = new Date(start).toISOString(); result.set(startsAt, { startsAt, endsAt: new Date(end).toISOString() });
      }
    }
  }
  return [...result.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
