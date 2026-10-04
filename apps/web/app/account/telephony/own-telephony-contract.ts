export interface OwnTelephonySnapshot {
  global: { enabled: boolean; mode: string };
  profile: null | { id: string; extension: string; enabled: boolean; state: string; version: number };
  workstation: null | {
    id: string; displayName: string; active: boolean; connectionState: string;
    sdkLoaded: boolean; sipRegistered: boolean; agentVersion: string; sdkVersion: string;
    lastSeenAt: string | null; pairedAt: string; revokedAt: string | null; version: number;
    inputConfigured: boolean; outputConfigured: boolean; lastErrorCode: string | null;
  };
  readiness: { available: boolean; reason: string | null };
  canPair: boolean; canRevoke: boolean;
  localPreferencesOnly: true; inboundEnabled: false; recordingEnabled: false;
}

export interface OwnPairingCode { code: string; expiresAt: string; profileId: string; version: number }
export type OwnTelephonyFailure = "session" | "forbidden" | "unavailable";

/** Public Web gateway, never the private API origin or a URL carrying credentials. */
export function ownAgentGatewayUrl(origin: string): string | undefined {
  try {
    const base = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) return undefined;
    return new URL("/agent/", base.origin).href;
  } catch { return undefined; }
}

export class OwnTelephonyRequestError extends Error {
  constructor(readonly kind: OwnTelephonyFailure, readonly code: string) { super(code); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("telephony_snapshot_invalid");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 250) throw new Error("telephony_snapshot_invalid");
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("telephony_snapshot_invalid");
  return value;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("telephony_snapshot_invalid");
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error("telephony_snapshot_invalid");
  return result;
}
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value); }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }

/** Explicit allowlist: unknown configuration, SIP secrets and tokens are never passed to the view. */
export function parseOwnTelephonySnapshot(value: unknown): OwnTelephonySnapshot {
  const dto = record(value), global = record(dto.global), readiness = record(dto.readiness);
  if (dto.localPreferencesOnly !== true || dto.inboundEnabled !== false || dto.recordingEnabled !== false) throw new Error("telephony_snapshot_invalid");
  const profile = dto.profile === null ? null : record(dto.profile);
  const workstation = dto.workstation === null ? null : record(dto.workstation);
  return {
    global: { enabled: flag(global.enabled), mode: text(global.mode) },
    profile: profile ? { id: text(profile.id), extension: text(profile.extension), enabled: flag(profile.enabled), state: text(profile.state), version: version(profile.version) } : null,
    workstation: workstation ? {
      id: text(workstation.id), displayName: text(workstation.displayName), active: flag(workstation.active), connectionState: text(workstation.connectionState),
      sdkLoaded: flag(workstation.sdkLoaded), sipRegistered: flag(workstation.sipRegistered), agentVersion: text(workstation.agentVersion), sdkVersion: text(workstation.sdkVersion),
      lastSeenAt: nullableTime(workstation.lastSeenAt), pairedAt: timestamp(workstation.pairedAt), revokedAt: nullableTime(workstation.revokedAt), version: version(workstation.version),
      inputConfigured: flag(workstation.inputConfigured), outputConfigured: flag(workstation.outputConfigured), lastErrorCode: nullableText(workstation.lastErrorCode),
    } : null,
    readiness: { available: flag(readiness.available), reason: nullableText(readiness.reason) },
    canPair: flag(dto.canPair), canRevoke: flag(dto.canRevoke), localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
  };
}

export function parseOwnPairingCode(value: unknown, now = Date.now()): OwnPairingCode {
  const dto = record(value), expiresAt = timestamp(dto.expiresAt), code = text(dto.code);
  if (!/^[A-Za-z0-9_-]{8,160}$/u.test(code) || Date.parse(expiresAt) <= now) throw new Error("telephony_pairing_invalid");
  return { code, expiresAt, profileId: text(dto.profileId), version: version(dto.version) };
}

export async function ownTelephonyRequest(path: string, init?: RequestInit, request: typeof fetch = fetch): Promise<unknown> {
  const response = await request(`/api/crm/telephony/me${path}`, {
    credentials: "same-origin", cache: "no-store", ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const safeCode = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" && /^telephony_[a-z_]{1,100}$/u.test(payload.code) ? payload.code : "telephony_unavailable";
    throw new OwnTelephonyRequestError(response.status === 401 ? "session" : response.status === 403 ? "forbidden" : "unavailable", safeCode);
  }
  return response.json() as Promise<unknown>;
}

export const readinessLabels: Readonly<Record<string, string>> = {
  READY: "Poste prêt pour une demande d’appel", MODE_DISABLED: "L’émission Liblinphone n’est pas activée dans le CRM.",
  USER_PROFILE_NOT_CONFIGURED: "Votre extension n’a pas encore été attribuée par un administrateur.", USER_PROFILE_DISABLED: "Votre profil téléphonique est désactivé.",
  USER_DISABLED: "Votre compte CRM est désactivé.", SERVER_PROFILE_DISABLED: "Le profil de connexion téléphonique est désactivé.",
  SERVER_PROFILE_SCOPE_MISMATCH: "Le profil téléphonique n’appartient plus à votre campus autorisé.", WORKSTATION_AMBIGUOUS: "Plusieurs postes actifs ont été détectés. Contactez l’administration ; aucun poste n’est choisi arbitrairement.",
  WORKSTATION_NOT_PAIRED: "Aucun poste actif n’est associé à votre profil.", WORKSTATION_OFFLINE: "L’agent est hors ligne ou son dernier contact est trop ancien.",
  SDK_NOT_LOADED: "Le SDK téléphonique n’est pas chargé sur votre poste.", SIP_NOT_REGISTERED: "L’enregistrement SIP n’a pas été confirmé par l’agent.",
  CALL_PERMISSION_REQUIRED: "Vos permissions permettent de consulter ce poste, mais pas de demander un appel.",
};

export function ownTelephonyError(failure: unknown): { kind: OwnTelephonyFailure; message: string } {
  if (failure instanceof OwnTelephonyRequestError) {
    if (failure.kind === "session") return { kind: "session", message: "Votre session a expiré. Reconnectez-vous pour retrouver votre poste." };
    if (failure.kind === "forbidden") return { kind: "forbidden", message: "Vos permissions actuelles ne permettent pas cette action. Aucun droit supplémentaire n’a été attribué." };
    const messages: Readonly<Record<string, string>> = {
      telephony_unavailable: "Le service téléphonique est momentanément indisponible. Aucun résultat n’est confirmé ; actualisez l’état avant de recommencer.",
      telephony_user_profile_not_configured: "Votre extension n’est plus attribuée. Actualisez puis contactez l’administration si nécessaire.",
      telephony_user_profile_inactive: "Votre profil téléphonique ou sa connexion est désactivé. Aucun poste n’a été associé.",
      telephony_workstation_not_found: "Ce poste n’est plus disponible pour votre compte. Actualisez ; aucun autre poste n’est choisi automatiquement.",
      telephony_expected_version_invalid: "La version du profil ou du poste n’a pas été confirmée. Actualisez avant de recommencer.",
      telephony_persistence_required: "La persistance du service téléphonique est indisponible. Aucun état local de secours n’est utilisé.",
      telephony_workstation_busy: "Un appel ou une commande est encore en cours. Terminez-le avant de révoquer ou de réassocier ce poste.",
      telephony_workstation_already_paired: "Un poste actif existe déjà. Actualisez son état ; révoquez-le explicitement avant toute nouvelle association.",
      telephony_user_profile_version_conflict: "Votre profil a changé. Actualisez avant de recommencer.",
      telephony_workstation_version_conflict: "Le poste a changé. Actualisez avant de recommencer.",
      telephony_profile_scope_forbidden: "Le profil n’est plus disponible dans votre périmètre.",
    };
    return { kind: "unavailable", message: messages[failure.code] ?? "L’opération n’a pas été confirmée. Actualisez l’état avant de recommencer ; aucune action n’est relancée automatiquement." };
  }
  return { kind: "unavailable", message: "Le service téléphonique est momentanément indisponible. Aucun état de disponibilité ne peut être confirmé." };
}
