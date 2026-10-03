export interface AdmissionsResponsibility { id: string; userId: string; label: string; campus: string; campusLabel?: string; active: boolean; version: number }
export interface AdmissionsContext {
  timezone: string; ownResponsibilities: AdmissionsResponsibility[]; canManageResponsibilities: boolean; canUseAgenda: boolean;
  campuses: Array<{ id: string; code: string; label: string }>;
  eligibleUsers: Array<{ id: string; label: string; campus: string }>;
}
export interface AdmissionsWindow { id: string; responsibilityId: string; campus: string; kind: "AVAILABLE" | "BLOCKED"; startsAt: string; endsAt: string; active: boolean; version: number }
export interface AdmissionsSlot { startsAt: string; endsAt: string }
export interface AdmissionsBooking {
  id: string; leadId: string; leadIdentifier: string; leadLabel: string; responsibilityId: string;
  responsibleId: string; responsibleLabel: string; requesterId: string; campus: string; campusLabel?: string; type: string; mode: string;
  state: "PENDING" | "ACCEPTED" | "REFUSED" | "CANCELLED"; appointmentState: string;
  startsAt: string; endsAt: string; durationMinutes: number; version: number;
  canDecide: boolean; canCancel: boolean; canReschedule: boolean; canComplete?: boolean; canNoShow?: boolean; canWriteReport?: boolean; reportResult?: string;
}
export interface AdmissionsBookingsPage { items: AdmissionsBooking[]; timezone?: string; hasMore?: boolean; nextCursor?: string }
export const appointmentTypeOptions = ["APPEL_INFORMATION", "VISITE_CAMPUS", "ENTRETIEN_ADMISSION", "ENTRETIEN_MOTIVATION", "TEST_ADMISSION", "RENDEZ_VOUS_DIRECTION", "RENDEZ_VOUS_LIBRE"] as const;
export const appointmentDurationOptions = [15, 30, 45, 60, 90, 120] as const;
export const admissionsStateLabels: Readonly<Record<AdmissionsBooking["state"], string>> = { PENDING: "En attente du responsable", ACCEPTED: "Accepté par le responsable", REFUSED: "Refusé", CANCELLED: "Annulé" };
export class AdmissionsApiError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
export async function admissionsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crm${path}`, { ...init, cache: "no-store", credentials: "same-origin", headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  if (!response.ok) { const payload = await response.json().catch(() => ({})) as { code?: string }; throw new AdmissionsApiError(payload.code ?? "admissions_unavailable", response.status); }
  return await response.json() as T;
}
export function admissionsError(error: unknown): string {
  if (error instanceof AdmissionsApiError) {
    if (error.status === 401) return "Votre session a expiré. Reconnectez-vous pour continuer ; aucune réussite n’est confirmée.";
    if (error.status === 403) return "Accès refusé : votre rôle ou votre campus ne permet pas cette action.";
    const messages: Readonly<Record<string, string>> = {
      admissions_invalid: "Vérifiez les dates futures, la durée et les champs obligatoires.",
      admissions_profile_inactive: "Ce responsable n’est plus disponible. Choisissez un profil actif autorisé.",
      admissions_self_approval_forbidden: "Le demandeur ne peut pas accepter sa propre demande.",
      admissions_booking_conflict: "Ce créneau n’est plus libre. Actualisez les disponibilités et choisissez-en un autre ; votre saisie est conservée.",
      admissions_window_in_use: "Cette plage porte une réservation active et ne peut pas être retirée.",
      admissions_version_conflict: "Une autre personne a modifié ces informations. Actualisez avant de réessayer ; votre saisie est conservée.",
      admissions_transition_refused: "L’état ou l’heure de ce rendez-vous ne permet pas cette action. Actualisez la demande avant de réessayer.",
      admissions_idempotency_conflict: "Cette tentative existe avec un contenu différent. Relisez les informations avant de réessayer.",
      admissions_not_found: "Cette ressource n’est plus accessible dans votre périmètre.",
      permission_store_unavailable: "Les autorisations ne peuvent pas être vérifiées. Aucune modification n’est confirmée.",
    };
    return messages[error.code] ?? "Le serveur n’a pas confirmé cette action. Votre saisie est conservée.";
  }
  return "La réponse du serveur est indisponible. Vérifiez l’agenda avant de réessayer ; votre saisie est conservée.";
}
export function casablancaParts(date: Date): Readonly<Record<string, string>> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
}
export function casablancaDateTimeToIso(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value); if (!match) return undefined;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])); let utc = target;
  for (let index = 0; index < 3; index += 1) { const parts = casablancaParts(new Date(utc)); const projected = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)); utc += target - projected; }
  const resolved = new Date(utc); const parts = casablancaParts(resolved);
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== value) return undefined;
  return resolved.toISOString();
}
export function admissionsToday(now = new Date()): string { const parts = casablancaParts(now); return `${parts.year}-${parts.month}-${parts.day}`; }
export function admissionsPeriod(day: string): { from: string; to: string } | undefined {
  const from = casablancaDateTimeToIso(`${day}T00:00`); const local = new Date(`${day}T00:00:00Z`); if (!from || !Number.isFinite(local.valueOf())) return undefined;
  local.setUTCDate(local.getUTCDate() + 1); const to = casablancaDateTimeToIso(`${local.toISOString().slice(0, 10)}T00:00`); return to ? { from, to } : undefined;
}
export function admissionsDate(value: string): string { const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : "Date à vérifier"; }
export function admissionsTime(value: string): string { const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit" }).format(date) : "—"; }
export function newAdmissionsAttempt(): string { return `admissions-${crypto.randomUUID()}`; }
export function sameAttempt(ref: { current: { payload: string; key: string } | undefined }, body: object): string { const payload = JSON.stringify(body); if (ref.current?.payload !== payload) ref.current = { payload, key: newAdmissionsAttempt() }; return ref.current.key; }
export function admissionsCampusLabel(campus: string, context?: Pick<AdmissionsContext, "campuses">): string { return context?.campuses.find((item) => item.code === campus || item.id === campus || item.label === campus)?.label ?? "Campus autorisé"; }
