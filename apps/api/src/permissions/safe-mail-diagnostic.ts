import { Prisma } from "@prisma/client";

export type MailFailurePhase = "CONTRACT" | "DATABASE_IDENTITY" | "CONFIGURATION_READ" | "DISCOVERY_FENCE" | "CANDIDATE_FENCE" | "CANDIDATE_FACTS" | "RETAIN_INTERRUPTED" | "JOURNAL_RESERVATION" | "TRANSPORT" | "JOURNAL_ACCEPTANCE" | "JOURNAL_UNCERTAIN" | "OPERATOR" | "CLEANUP";
export interface SafeMailDiagnostic { phase: MailFailurePhase; vendorCode: "P2010" | "P2034" | "P2028" | "P2024" | "P1001" | "UNKNOWN"; sqlState: "55P03" | "UNKNOWN"; attempts: number; handlerStarted: boolean; cleanupFailed: boolean }
const diagnostics = new WeakMap<object, SafeMailDiagnostic>();
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
export function initialFenceLockUnavailable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && own(error, "code") === "P2010" && own(own(error, "meta"), "code") === "55P03";
}
export function mailDiagnostic(error: unknown): SafeMailDiagnostic {
  if (error && typeof error === "object") {
    const retained = diagnostics.get(error); if (retained) return { ...retained };
  }
  const code = own(error, "code");
  return { phase: "CONTRACT", vendorCode: code === "P2010" || code === "P2034" || code === "P2028" || code === "P2024" || code === "P1001" ? code : "UNKNOWN",
    sqlState: initialFenceLockUnavailable(error) ? "55P03" : "UNKNOWN", attempts: 0, handlerStarted: false, cleanupFailed: false };
}
/** Only safe enums/counts are retained, never the original error/meta/message/stack. */
export function retainMailFailure(error: unknown, phase: MailFailurePhase, fields: Partial<SafeMailDiagnostic> = {}): Error {
  const target = error instanceof Error ? error : new Error("business_mail_failure");
  const previous = diagnostics.get(target), safe = Object.freeze({ ...mailDiagnostic(error), phase: previous?.phase ?? phase, ...fields });
  diagnostics.set(target, safe);
  try { Object.defineProperty(target, "cause", { value: safe, enumerable: false, configurable: true }); } catch { /* WeakMap also supports frozen errors. */ }
  return target;
}
export async function mailStage<T>(phase: MailFailurePhase, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw retainMailFailure(error, phase); }
}
export async function withMailCleanup<T>(action: () => Promise<T>, cleanup: Array<() => Promise<void>>): Promise<T> {
  let failed = false, primary: unknown, result: T | undefined;
  try { result = await action(); } catch (error) { failed = true; primary = error; }
  const settled = await Promise.allSettled(cleanup.map(close => Promise.resolve().then(close)));
  const cleanupFailed = settled.some(value => value.status === "rejected");
  if (failed) throw retainMailFailure(primary, "CONTRACT", { cleanupFailed });
  if (cleanupFailed) throw retainMailFailure(new Error("business_mail_cleanup_failed"), "CLEANUP", { cleanupFailed: true });
  return result as T;
}
