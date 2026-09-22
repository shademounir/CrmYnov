import { createHmac, randomUUID } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

export type TelephonyProvider = "MANUAL_EXTERNAL" | "COOVOX" | "LINPHONE";
export interface AdapterCallRequest { direction: "INBOUND" | "OUTBOUND"; phoneFingerprint: string; correlationId: string }
export interface AdapterCallReceipt { provider: TelephonyProvider; externalId: string; initialState: "REQUESTED" }
export interface TelephonyAdapter {
  readonly provider: TelephonyProvider;
  readonly available: boolean;
  initiate(request: AdapterCallRequest): AdapterCallReceipt;
  cancel(externalId: string): { externalId: string; accepted: boolean };
  state(externalId: string): { externalId: string; provider: TelephonyProvider; configured: boolean };
}

export type BridgeDispatchOutcome =
  | { state: "ACCEPTED"; bridgeVersion?: string }
  | { state: "REJECTED"; reasonCode: string }
  | { state: "UNCERTAIN"; reasonCode: "BRIDGE_TIMEOUT" | "BRIDGE_UNREACHABLE" };

export type BridgeReadinessReason = "READY" | "NOT_CONFIGURED" | "UNREACHABLE" | "SDK_NOT_LOADED" | "SIP_NOT_REGISTERED";

export interface LinphoneBridgeCommand {
  schemaVersion: "1";
  commandId: string;
  callId: string;
  destination: string;
  maxDurationSeconds: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

/** Server-to-local-bridge client. Raw destinations only exist in this request body. */
export class LinphoneBridgeAdapter {
  readonly provider = "LINPHONE" as const;
  private readonly baseUrl?: URL;

  constructor(
    url = process.env.TELEPHONY_LINPHONE_BRIDGE_URL?.trim() ?? "",
    private readonly secret = process.env.TELEPHONY_LINPHONE_BRIDGE_SECRET?.trim() ?? "",
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly timeoutMs = 4_000,
    private readonly bridgeId = process.env.TELEPHONY_LINPHONE_BRIDGE_ID?.trim() ?? "",
  ) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) this.baseUrl = parsed;
    } catch { /* invalid and non-local URLs fail closed */ }
  }

  get configured(): boolean { return Boolean(this.baseUrl && this.secret.length >= 32 && /^[A-Za-z0-9_-]{8,64}$/.test(this.bridgeId)); }

  async readiness(): Promise<{ available: boolean; reason: BridgeReadinessReason; bridgeVersion?: string; sdkLoaded?: boolean; sipRegistered?: boolean }> {
    if (!this.configured || !this.baseUrl) return { available: false, reason: "NOT_CONFIGURED" };
    try {
      const response = await this.signedFetch("health", { schemaVersion: "1", probeId: randomUUID() }, 2_000);
      if (!response.ok) return { available: false, reason: "UNREACHABLE" };
      const body = await response.json() as Record<string, unknown>;
      const sdkLoaded = body.sdkLoaded === true; const sipRegistered = body.sipRegistered === true;
      const reason: BridgeReadinessReason = !sdkLoaded ? "SDK_NOT_LOADED" : !sipRegistered ? "SIP_NOT_REGISTERED" : "READY";
      return { available: sdkLoaded && sipRegistered, reason,
        ...(typeof body.bridgeVersion === "string" ? { bridgeVersion: body.bridgeVersion.slice(0, 40) } : {}), sdkLoaded, sipRegistered };
    } catch { return { available: false, reason: "UNREACHABLE" }; }
  }

  async initiate(command: LinphoneBridgeCommand): Promise<BridgeDispatchOutcome> {
    if (!this.configured || !this.baseUrl) return { state: "REJECTED", reasonCode: "BRIDGE_NOT_CONFIGURED" };
    try {
      const response = await this.signedFetch("v1/calls", command, this.timeoutMs);
      if (response.ok) {
        const body = await response.json() as Record<string, unknown>;
        if (body.commandId !== command.commandId || body.accepted !== true) return { state: "REJECTED", reasonCode: "BRIDGE_RESPONSE_INVALID" };
        return { state: "ACCEPTED", ...(typeof body.bridgeVersion === "string" ? { bridgeVersion: body.bridgeVersion.slice(0, 40) } : {}) };
      }
      return { state: "REJECTED", reasonCode: response.status === 401 || response.status === 403 ? "BRIDGE_UNAUTHORIZED" : "BRIDGE_REJECTED" };
    } catch (error) {
      return { state: "UNCERTAIN", reasonCode: error instanceof DOMException && error.name === "TimeoutError" ? "BRIDGE_TIMEOUT" : "BRIDGE_UNREACHABLE" };
    }
  }

  async end(commandId: string, callId: string): Promise<BridgeDispatchOutcome> {
    if (!this.configured || !this.baseUrl) return { state: "REJECTED", reasonCode: "BRIDGE_NOT_CONFIGURED" };
    try {
      const response = await this.signedFetch(`v1/calls/${encodeURIComponent(commandId)}/end`, { schemaVersion: "1", commandId, callId }, this.timeoutMs);
      return response.ok ? { state: "ACCEPTED" } : { state: "REJECTED", reasonCode: response.status === 401 || response.status === 403 ? "BRIDGE_UNAUTHORIZED" : "BRIDGE_REJECTED" };
    } catch (error) {
      return { state: "UNCERTAIN", reasonCode: error instanceof DOMException && error.name === "TimeoutError" ? "BRIDGE_TIMEOUT" : "BRIDGE_UNREACHABLE" };
    }
  }

  private async signedFetch(path: string, body: object, timeoutMs: number): Promise<Response> {
    const timestamp = String(Date.now()); const nonce = randomUUID(); const serialized = canonical(body);
    const signature = `sha256=${createHmac("sha256", this.secret).update(`${this.bridgeId}.${timestamp}.${nonce}.${serialized}`).digest("hex")}`;
    return this.request(new URL(path, this.baseUrl), { method: "POST", headers: { "content-type": "application/json", "x-crm-bridge-timestamp": timestamp,
      "x-crm-bridge-id": this.bridgeId, "x-crm-bridge-nonce": nonce, "x-crm-bridge-signature": signature }, body: serialized, signal: AbortSignal.timeout(timeoutMs) });
  }
}

export function canonicalizeBridgePayload(value: unknown): string { return canonical(value); }

export class ManualExternalTelephonyAdapter implements TelephonyAdapter {
  readonly provider = "MANUAL_EXTERNAL" as const;
  readonly available = true;
  initiate(request: AdapterCallRequest): AdapterCallReceipt { void request; return { provider: this.provider, externalId: `manual-${randomUUID()}`, initialState: "REQUESTED" }; }
  cancel(externalId: string): { externalId: string; accepted: boolean } { return { externalId, accepted: true }; }
  state(externalId: string): { externalId: string; provider: TelephonyProvider; configured: boolean } { return { externalId, provider: this.provider, configured: true }; }
}

export class SyntheticTelephonyAdapter implements TelephonyAdapter {
  readonly provider = "MANUAL_EXTERNAL" as const;
  readonly available = true;
  initiate(request: AdapterCallRequest): AdapterCallReceipt { return { provider: this.provider, externalId: `synthetic-${request.correlationId}`, initialState: "REQUESTED" }; }
  cancel(externalId: string): { externalId: string; accepted: boolean } { return { externalId, accepted: true }; }
  state(externalId: string): { externalId: string; provider: TelephonyProvider; configured: boolean } { return { externalId, provider: this.provider, configured: true }; }
}

export class DisabledTelephonyAdapter implements TelephonyAdapter {
  readonly available = false;
  constructor(readonly provider: "COOVOX" | "LINPHONE") {}
  private unavailable(): never { throw new ServiceUnavailableException({ code: "provider_not_configured", provider: this.provider }); }
  initiate(request: AdapterCallRequest): AdapterCallReceipt { void request; return this.unavailable(); }
  cancel(externalId: string): { externalId: string; accepted: boolean } { void externalId; return this.unavailable(); }
  state(externalId: string): { externalId: string; provider: TelephonyProvider; configured: boolean } { void externalId; return this.unavailable(); }
}
