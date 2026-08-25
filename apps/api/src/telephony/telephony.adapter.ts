import { randomUUID } from "node:crypto";
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
