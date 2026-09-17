import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Principal, Role } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { canonicalizeBridgePayload, DisabledTelephonyAdapter, LinphoneBridgeAdapter, ManualExternalTelephonyAdapter, type BridgeReadinessReason, type TelephonyAdapter, type TelephonyProvider } from "./telephony.adapter.js";
import { TelephonyPersistenceRepository } from "./telephony-persistence.repository.js";
import { TelephonyAgentRepository } from "./telephony-agent.repository.js";

export const telephonyModes = ["MANUAL_EXTERNAL", "COOVOX", "LINPHONE", "DISABLED"] as const;
export type TelephonyMode = typeof telephonyModes[number];
export const callStates = ["REQUESTED", "DIALING", "RINGING", "ANSWERED", "MISSED", "FAILED", "CANCELLED", "ENDED"] as const;
export type CallState = typeof callStates[number];
export type CallDirection = "INBOUND" | "OUTBOUND";
export type MatchState = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "CONFIRMED";
export type RecordingState = "AVAILABLE" | "UNAVAILABLE" | "RESTRICTED" | "EXPIRED";
export type DispatchState = "PENDING" | "ACCEPTED" | "UNCERTAIN" | "REJECTED";

export interface TelephonyConfiguration {
  mode: TelephonyMode; clickToCallEnabled: boolean; inboundEnabled: boolean; outboundEnabled: boolean;
  recordingPolicy: "DISABLED" | "METADATA_ONLY"; maxCallDurationSeconds: number; secretReference?: string;
  version: number; updatedBy: string; updatedAt: string; webhookEnabled: false;
}
export interface CallEvent { id: string; callId: string; idempotencyKey: string; eventType: "STATE" | "COMPENSATION"; state: CallState; reasonCode?: string; actorId?: string; occurredAt: string; receivedAt: string }
export interface RecordingMetadata { recordingId: string; state: RecordingState; durationSeconds?: number; provider: TelephonyProvider; storageReference?: string; authorizedRoles: Role[] }
export interface CallRecord {
  id: string; provider: TelephonyProvider; externalId: string; direction: CallDirection; state: CallState; leadId?: string;
  phoneFingerprint: string; maskedPhone: string; matchState: MatchState; requestedAt: string; answeredAt?: string; endedAt?: string;
  durationSeconds?: number; createdBy: string; dispatchState: DispatchState; dispatchErrorCode?: string; dispatchUpdatedAt?: string;
  recording: RecordingMetadata; events: CallEvent[];
}
export interface AssociationCandidate { id: string; leadCode: string; displayName: string; campus: string }
export interface TelephonyConfigurationView extends TelephonyConfiguration {
  outboundReadiness: { available: boolean; reason: BridgeReadinessReason | "MODE_DISABLED" | "USER_PROFILE_DISABLED" | "USER_DISABLED" | "SERVER_PROFILE_DISABLED" | "WORKSTATION_NOT_PAIRED" | "WORKSTATION_OFFLINE"; bridgeVersion?: string; sdkLoaded?: boolean; sipRegistered?: boolean; identityLabel?: string };
}
export interface TelephonyBridgeEvent {
  schemaVersion: "1"; commandId: string; eventId: string; state: CallState; occurredAt: string; reasonCode?: string;
}

const transitions: Readonly<Record<CallState, readonly CallState[]>> = {
  REQUESTED: ["DIALING", "RINGING", "ANSWERED", "FAILED", "CANCELLED"], DIALING: ["RINGING", "ANSWERED", "MISSED", "FAILED", "CANCELLED"], RINGING: ["ANSWERED", "MISSED", "FAILED", "CANCELLED"],
  ANSWERED: ["ENDED", "FAILED"], MISSED: [], FAILED: [], CANCELLED: [], ENDED: [],
};
const contributorRoles: readonly Role[] = ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"];

@Injectable()
export class TelephonyService implements OnModuleInit {
  private config: Readonly<TelephonyConfiguration> = Object.freeze({ mode: "DISABLED", clickToCallEnabled: false, inboundEnabled: false, outboundEnabled: false, recordingPolicy: "DISABLED", maxCallDurationSeconds: 7200, version: 1, updatedBy: "system", updatedAt: new Date(0).toISOString(), webhookEnabled: false });
  private readonly calls = new Map<string, Readonly<CallRecord>>();
  private readonly callByProviderId = new Map<string, string>();
  private readonly eventReceipts = new Map<string, CallEvent>();
  private readonly adapters: Readonly<Record<TelephonyProvider, TelephonyAdapter>>;
  private readonly linphoneBridge: LinphoneBridgeAdapter;
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Optional() @Inject(TelephonyPersistenceRepository) private readonly persistence?: TelephonyPersistenceRepository,
    @Optional() @Inject(TelephonyAgentRepository) private readonly agents?: TelephonyAgentRepository,
  ) {
    this.adapters = { MANUAL_EXTERNAL: new ManualExternalTelephonyAdapter(), COOVOX: new DisabledTelephonyAdapter("COOVOX"), LINPHONE: new DisabledTelephonyAdapter("LINPHONE") };
    this.linphoneBridge = new LinphoneBridgeAdapter();
  }

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }

  async permissionLeadIdForApi(id: string): Promise<string | undefined> {
    if (!this.persistence?.enabled) return this.permissionLeadId(id);
    const leadId = await this.persistence.permissionLeadId(id);
    if (leadId === undefined) throw new NotFoundException({ code: "call_not_found" });
    return leadId ?? undefined;
  }

  async configurationForApi(principal?: Principal): Promise<TelephonyConfigurationView> {
    await this.refreshPersistentState();
    if (this.agents?.enabled && principal) {
      const readiness = await this.agents.readiness(principal.userId);
      return { ...this.configuration(), outboundReadiness: { available: readiness.available, reason: readiness.available ? "READY" : readiness.reason as TelephonyConfigurationView["outboundReadiness"]["reason"], ...(readiness.identityLabel ? { identityLabel: readiness.identityLabel } : {}), sdkLoaded: readiness.available, sipRegistered: readiness.available } };
    }
    if (this.config.mode !== "LINPHONE") return { ...this.configuration(), outboundReadiness: { available: false, reason: "MODE_DISABLED" } };
    return { ...this.configuration(), outboundReadiness: await this.linphoneBridge.readiness() };
  }

  async configureForApi(input: Parameters<TelephonyService["configure"]>[0], principal: Principal, correlationId: string): Promise<TelephonyConfiguration> {
    if (input.mode === "LINPHONE" && input.outboundEnabled) {
      const readiness = this.agents?.enabled ? await this.agents.readiness(principal.userId) : await this.linphoneBridge.readiness();
      if (!readiness.available) throw new ServiceUnavailableException({ code: "telephony_bridge_not_ready", reason: readiness.reason });
    }
    await this.refreshPersistentState(); const configuration = this.configure(input, principal, correlationId);
    if (!this.persistence?.enabled) return configuration;
    try { await this.persistence.persistConfiguration(configuration, principal, correlationId); await this.refreshPersistentState(); return this.configuration(); }
    catch (error) { await this.refreshPersistentState(); throw error; }
  }

  async initiateForApi(leadId: string, input: Parameters<TelephonyService["initiate"]>[1], principal: Principal, correlationId: string): Promise<CallRecord> {
    await this.preparePersistentMutation();
    if (!this.persistence?.enabled || this.config.mode !== "LINPHONE") {
      const record = this.initiate(leadId, input, principal, correlationId);
      if (!this.persistence?.enabled) return record;
      const event = record.events.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (!event) throw new Error("telephony_create_event_missing");
      try { await this.persistence.persistCreate(record, event, principal, correlationId); await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(record.id)!); }
      catch (error) { await this.refreshAfterPersistentMutation(); throw error; }
    }
    this.assertOutboundInput(leadId, input, principal, correlationId);
    const replayId = this.callByProviderId.get(`LINPHONE:request:${input.idempotencyKey}`);
    if (replayId) return this.copy(this.calls.get(replayId)!);
    const readiness = this.agents?.enabled ? await this.agents.readiness(principal.userId) : await this.linphoneBridge.readiness();
    if (!readiness.available) throw new ServiceUnavailableException({ code: "telephony_bridge_not_ready", reason: readiness.reason });
    const lead = this.scopedLead(leadId, principal, correlationId); if (!lead.phone) throw new BadRequestException({ code: "lead_phone_missing" });
    const normalized = this.normalizePhone(lead.phone); const commandId = randomUUID();
    const record = this.createCall({ provider: "LINPHONE", externalId: commandId, direction: "OUTBOUND", leadId, phone: normalized,
      matchState: "MATCHED", principal, idempotencyKey: input.idempotencyKey!, correlationId, dispatchState: "PENDING" });
    const event = record.events.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (!event) throw new Error("telephony_create_event_missing");
    try {
      const created = await this.persistence.persistCreate(record, event, principal, correlationId);
      await this.refreshAfterPersistentMutation();
      if (!created) return this.copy(this.calls.get(this.callByProviderId.get(`LINPHONE:request:${input.idempotencyKey}`)!)!);
      const outcome = this.agents?.enabled
        ? await this.agents.enqueue(record.id, principal.userId, normalized).then(() => ({ state: "ACCEPTED" as const, reasonCode: undefined }))
        : await this.linphoneBridge.initiate({ schemaVersion: "1", commandId, callId: record.id, destination: normalized, maxDurationSeconds: this.config.maxCallDurationSeconds });
      await this.persistence.persistDispatch(record.id, "PENDING", outcome.state, outcome.state === "ACCEPTED" ? undefined : outcome.reasonCode);
      await this.refreshAfterPersistentMutation();
      if (outcome.state === "REJECTED") await this.receiveEventForApi(record.id, { idempotencyKey: `bridge-rejected-${record.id}`, state: "FAILED" }, principal, `${correlationId}:bridge-rejected`);
      return this.copy(this.calls.get(record.id)!);
    } catch (error) {
      // A persisted call request must never remain "pending" when dispatch did
      // not complete.  UNCERTAIN is deliberately fail-closed: the client must
      // inspect the agent state and must not redial automatically.
      try { await this.persistence.persistDispatch(record.id, "PENDING", "UNCERTAIN", "AGENT_DISPATCH_FAILED"); } catch { /* another transition already won */ }
      await this.refreshAfterPersistentMutation(); throw error;
    }
  }

  async ingestSyntheticIncomingForApi(input: Parameters<TelephonyService["ingestSyntheticIncoming"]>[0], principal: Principal, correlationId: string): Promise<CallRecord> {
    await this.preparePersistentMutation(); const record = this.ingestSyntheticIncoming(input, principal, correlationId);
    if (!this.persistence?.enabled) return record;
    const event = record.events.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (!event) throw new Error("telephony_create_event_missing");
    try { await this.persistence.persistCreate(record, event, principal, correlationId); await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(record.id)!); }
    catch (error) { await this.refreshAfterPersistentMutation(); throw error; }
  }

  async receiveEventForApi(callId: string, input: Parameters<TelephonyService["receiveEvent"]>[1], principal: Principal, correlationId: string): Promise<CallRecord> {
    await this.preparePersistentMutation(); const previous = this.copy(this.requiredCall(callId, principal, correlationId)); const record = this.receiveEvent(callId, input, principal, correlationId);
    if (!this.persistence?.enabled) return record;
    const event = record.events.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (!event) throw new Error("telephony_transition_event_missing");
    try { await this.persistence.persistTransition(previous, record, event, principal, correlationId); await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(record.id)!); }
    catch (error) { await this.refreshAfterPersistentMutation(); throw error; }
  }

  async compensateForApi(callId: string, input: Parameters<TelephonyService["compensate"]>[1], principal: Principal, correlationId: string): Promise<CallRecord> {
    await this.preparePersistentMutation(); const record = this.compensate(callId, input, principal, correlationId);
    if (!this.persistence?.enabled) return record;
    const event = record.events.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (!event) throw new Error("telephony_compensation_event_missing");
    try { await this.persistence.persistCompensation(record, event, principal, correlationId); await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(record.id)!); }
    catch (error) { await this.refreshAfterPersistentMutation(); throw error; }
  }

  async confirmAssociationForApi(callId: string, leadId: string, principal: Principal, correlationId: string): Promise<CallRecord> {
    await this.preparePersistentMutation(); const previous = this.copy(this.requiredCall(callId, principal, correlationId)); const record = this.confirmAssociation(callId, leadId, principal, correlationId);
    if (!this.persistence?.enabled) return record;
    const event = record.events.at(-1);
    if (!event || event.eventType !== "COMPENSATION" || event.reasonCode !== "ASSOCIATION_CONFIRMED") throw new Error("telephony_association_event_missing");
    try { await this.persistence.persistAssociation(previous, record, event, principal, correlationId); await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(record.id)!); }
    catch (error) { await this.refreshAfterPersistentMutation(); throw error; }
  }

  async callForApi(callId: string, principal: Principal, correlationId: string): Promise<CallRecord> { await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); return this.call(callId, principal, correlationId); }
  async callsForLeadForApi(leadId: string, principal: Principal, correlationId: string): Promise<{ items: CallRecord[] }> {
    await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); this.scopedLead(leadId, principal, correlationId);
    return { items: [...this.calls.values()].filter((call) => call.leadId === leadId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt) || left.id.localeCompare(right.id))
      .map((call) => this.copy(call)) };
  }
  async associationCandidatesForApi(callId: string, principal: Principal, correlationId: string): Promise<{ items: AssociationCandidate[] }> {
    await this.preparePersistentMutation();
    if (!principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) throw new ForbiddenException({ code: "telephony_association_forbidden" });
    const call = this.requiredCall(callId, principal, correlationId);
    if (call.leadId || !["UNMATCHED", "AMBIGUOUS"].includes(call.matchState)) return { items: [] };
    const items: AssociationCandidate[] = [];
    let page = 1;
    while (page <= 100) {
      const result = this.leads.listLeads({ page, pageSize: 100, sortBy: "leadCode", sortDirection: "asc" }, principal, `${correlationId}:candidate:${page}`);
      for (const lead of result.items) {
        if (lead.phone && this.fingerprint(this.normalizePhone(lead.phone)) === call.phoneFingerprint) {
          items.push({ id: lead.id, leadCode: lead.leadCode, displayName: `${lead.firstName} ${lead.lastName}`.trim(), campus: lead.campus });
        }
      }
      if (page * result.pageSize >= result.total) break;
      page += 1;
    }
    return { items };
  }
  async queueForApi(principal: Principal): Promise<ReturnType<TelephonyService["queue"]>> { await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); return this.queue(principal); }
  async recordingForApi(callId: string, principal: Principal, correlationId: string): Promise<RecordingMetadata> {
    await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); const metadata = this.recording(callId, principal, correlationId);
    if (this.persistence?.enabled) await this.persistence.persistRecordingAccess(this.copy(this.calls.get(callId)!), principal, correlationId);
    return metadata;
  }

  async endForApi(callId: string, principal: Principal, correlationId: string): Promise<{ accepted: boolean; uncertain: boolean; call: CallRecord }> {
    await this.preparePersistentMutation(); this.assertContributor(principal); const call = this.requiredCall(callId, principal, correlationId);
    if (call.provider !== "LINPHONE" || call.direction !== "OUTBOUND") throw new ConflictException({ code: "telephony_end_not_supported" });
    if (!["REQUESTED", "DIALING", "RINGING", "ANSWERED"].includes(call.state)) throw new ConflictException({ code: "telephony_call_not_active" });
    if (this.agents?.enabled) {
      await this.agents.requestHangup(call.id, principal.userId);
      return { accepted: true, uncertain: false, call: this.copy(call) };
    }
    const outcome = await this.linphoneBridge.end(call.externalId, call.id);
    if (outcome.state === "REJECTED") throw new ServiceUnavailableException({ code: "telephony_bridge_end_rejected", reason: outcome.reasonCode });
    return { accepted: outcome.state === "ACCEPTED", uncertain: outcome.state === "UNCERTAIN", call: this.copy(call) };
  }

  async receiveBridgeEventForApi(body: TelephonyBridgeEvent, headers: { bridgeId: string; timestamp: string; nonce: string; signature: string }): Promise<CallRecord> {
    this.verifyBridgeRequest(body, headers);
    if (!this.persistence?.enabled) throw new ServiceUnavailableException({ code: "telephony_persistence_required" });
    if (body.schemaVersion !== "1" || !/^[0-9a-f-]{36}$/iu.test(body.commandId) || !/^[A-Za-z0-9_-]{8,160}$/.test(body.eventId)
      || !callStates.includes(body.state) || body.state === "REQUESTED" || Number.isNaN(Date.parse(body.occurredAt))) throw new BadRequestException({ code: "telephony_bridge_event_invalid" });
    const callId = await this.persistence.callIdForCommand(body.commandId);
    if (!callId) throw new NotFoundException({ code: "telephony_command_not_found" });
    await this.refreshPersistentState(); const current = this.calls.get(callId);
    if (!current) throw new NotFoundException({ code: "telephony_call_not_found" });
    if (["PENDING", "UNCERTAIN"].includes(current.dispatchState)) {
      await this.persistence.persistDispatch(callId, current.dispatchState, "ACCEPTED");
      await this.refreshPersistentState();
    }
    const refreshed = this.calls.get(callId); if (!refreshed) throw new NotFoundException({ code: "telephony_call_not_found" });
    const previous = this.copy(refreshed); const principal = this.bridgePrincipal();
    const record = this.applyEvent(refreshed, { idempotencyKey: `bridge-${body.eventId}`, state: body.state, occurredAt: body.occurredAt }, principal, `bridge:${body.eventId}`, false);
    const event = record.events.find((item) => item.idempotencyKey === `bridge-${body.eventId}`);
    if (!event) throw new Error("telephony_transition_event_missing");
    await this.persistence.persistTransition(previous, record, event, principal, `bridge:${body.eventId}`);
    await this.refreshAfterPersistentMutation(); return this.copy(this.calls.get(callId)!);
  }

  async receiveAgentEventForApi(callId: string, input: { idempotencyKey?: string; state?: string; occurredAt?: string; reasonCode?: string }, principal: Principal, correlationId: string): Promise<CallRecord> {
    if (!this.persistence?.enabled) throw new ServiceUnavailableException({ code: "telephony_persistence_required" });
    if (input.reasonCode && !/^[A-Z][A-Z0-9_]{2,63}$/u.test(input.reasonCode)) throw new BadRequestException({ code: "telephony_agent_reason_invalid" });
    await this.refreshPersistentState();
    const current = this.calls.get(callId);
    if (!current) throw new NotFoundException({ code: "telephony_call_not_found" });
    if (["PENDING", "UNCERTAIN"].includes(current.dispatchState)) {
      await this.persistence.persistDispatch(callId, current.dispatchState, "ACCEPTED");
      await this.refreshPersistentState();
    }
    return this.receiveEventForApi(callId, input, principal, correlationId);
  }

  /** Internal locator; the browser cannot supply the resource's authority. */
  permissionLeadId(id: string): string | undefined {
    const call = this.calls.get(id);
    if (!call) throw new NotFoundException({ code: "call_not_found" });
    return call.leadId;
  }
  configuration(): TelephonyConfiguration { return { ...this.config }; }
  configure(input: Partial<Omit<TelephonyConfiguration, "version" | "updatedBy" | "updatedAt" | "webhookEnabled">> & { expectedVersion?: number }, principal: Principal, correlationId: string): TelephonyConfiguration {
    if (!principal.roles.includes("SUPER_ADMIN")) throw new ForbiddenException({ code: "telephony_configuration_forbidden" });
    if (input.expectedVersion !== this.config.version || !input.mode || !telephonyModes.includes(input.mode)) throw new ConflictException({ code: "telephony_configuration_version_conflict" });
    const requestedDuration = input.maxCallDurationSeconds;
    if (typeof requestedDuration !== "number" || !Number.isInteger(requestedDuration) || requestedDuration < 60 || requestedDuration > 14_400) throw new BadRequestException({ code: "telephony_duration_threshold_invalid" });
    if (input.recordingPolicy !== "DISABLED" && input.recordingPolicy !== "METADATA_ONLY") throw new BadRequestException({ code: "telephony_recording_policy_invalid" });
    if (input.secretReference && (!/^ref:[A-Za-z0-9._/-]{3,150}$/.test(input.secretReference) || /@|password|token=|https?:|\d{8,}/i.test(input.secretReference))) throw new BadRequestException({ code: "telephony_secret_reference_invalid" });
    const before = this.config; const now = new Date().toISOString(); const maxCallDurationSeconds = requestedDuration; const recordingPolicy = input.recordingPolicy;
    this.config = Object.freeze({ mode: input.mode, clickToCallEnabled: Boolean(input.clickToCallEnabled), inboundEnabled: Boolean(input.inboundEnabled), outboundEnabled: Boolean(input.outboundEnabled), recordingPolicy, maxCallDurationSeconds, ...(input.secretReference ? { secretReference: input.secretReference } : {}), version: before.version + 1, updatedBy: principal.userId, updatedAt: now, webhookEnabled: false });
    this.audit.record({ eventType: "TELEPHONY_CONFIGURATION_CHANGED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, before: { mode: before.mode, version: before.version }, after: { mode: this.config.mode, version: this.config.version, recordingPolicy: this.config.recordingPolicy }, result: "SUCCESS", idempotencyKey: `telephony-config:${this.config.version}` });
    return { ...this.config };
  }

  initiate(leadId: string, input: { idempotencyKey?: string; followUpComment?: string; nextActionAt?: string }, principal: Principal, correlationId: string): CallRecord {
    this.assertContributor(principal); this.scopedLead(leadId, principal, correlationId);
    if (!input.idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "telephony_idempotency_invalid" });
    if (this.config.mode === "DISABLED" || !this.config.outboundEnabled || !this.config.clickToCallEnabled) throw new ServiceUnavailableException({ code: "telephony_provider_disabled" });
    const adapter = this.adapters[this.config.mode as TelephonyProvider];
    const replayId = this.callByProviderId.get(`${adapter.provider}:request:${input.idempotencyKey}`); if (replayId) return this.copy(this.calls.get(replayId)!);
    const lead = this.scopedLead(leadId, principal, correlationId); if (!lead.phone) throw new BadRequestException({ code: "lead_phone_missing" });
    const normalized = this.normalizePhone(lead.phone); const fingerprint = this.fingerprint(normalized); const receipt = adapter.initiate({ direction: "OUTBOUND", phoneFingerprint: fingerprint, correlationId });
    const call = this.createCall({ provider: receipt.provider, externalId: receipt.externalId, direction: "OUTBOUND", leadId, phone: normalized, matchState: "MATCHED", principal, idempotencyKey: input.idempotencyKey, correlationId });
    this.callByProviderId.set(`${adapter.provider}:request:${input.idempotencyKey}`, call.id);
    if (input.followUpComment || input.nextActionAt) this.leads.addActivity(leadId, { type: "CRM_CALL", result: "CALL_REQUESTED", ...(input.followUpComment ? { note: input.followUpComment } : {}), ...(input.nextActionAt ? { nextActionAt: input.nextActionAt } : {}) }, principal, correlationId);
    return call;
  }

  ingestSyntheticIncoming(input: { provider: TelephonyProvider; externalId: string; phone: string; idempotencyKey: string; occurredAt: string }, principal: Principal, correlationId: string): CallRecord {
    this.assertContributor(principal); if (!this.config.inboundEnabled) throw new ServiceUnavailableException({ code: "telephony_inbound_disabled" });
    if (input.provider !== "MANUAL_EXTERNAL") this.adapters[input.provider].state(input.externalId);
    const existingId = this.callByProviderId.get(`${input.provider}:${input.externalId}`); if (existingId) return this.copy(this.calls.get(existingId)!);
    const phone = this.normalizePhone(input.phone); const page = this.leads.listLeads({ page: 1, pageSize: 100, search: phone }, principal, correlationId);
    const matches = page.items.filter((lead) => lead.phone && this.normalizePhone(lead.phone) === phone).map((lead) => lead.id);
    const matchState: MatchState = matches.length === 1 ? "MATCHED" : matches.length === 0 ? "UNMATCHED" : "AMBIGUOUS";
    return this.createCall({ provider: input.provider, externalId: input.externalId, direction: "INBOUND", ...(matches.length === 1 ? { leadId: matches[0] } : {}), phone, matchState, principal, idempotencyKey: input.idempotencyKey, correlationId, occurredAt: input.occurredAt });
  }

  receiveEvent(callId: string, input: { idempotencyKey?: string; state?: string; occurredAt?: string; reasonCode?: string }, principal: Principal, correlationId: string): CallRecord {
    this.assertContributor(principal); const current = this.requiredCall(callId, principal, correlationId);
    return this.applyEvent(current, input, principal, correlationId, true);
  }

  private applyEvent(current: Readonly<CallRecord>, input: { idempotencyKey?: string; state?: string; occurredAt?: string; reasonCode?: string }, principal: Principal, correlationId: string, volatileEvidence: boolean): CallRecord {
    const callId = current.id;
    if (!input.idempotencyKey || !/^[A-Za-z0-9_-]{8,160}$/.test(input.idempotencyKey) || !callStates.includes(input.state as CallState)) throw new BadRequestException({ code: "telephony_event_invalid" });
    const receipt = this.eventReceipts.get(input.idempotencyKey); if (receipt) { if (receipt.callId !== callId || receipt.state !== input.state) throw new ConflictException({ code: "telephony_event_idempotency_conflict" }); return this.copy(current); }
    const occurredAt = this.timestamp(input.occurredAt, "telephony_event_timestamp_invalid"); const last = current.events.at(-1); if (last && occurredAt < last.occurredAt) throw new ConflictException({ code: "telephony_event_out_of_order" });
    const next = input.state as CallState; if (!transitions[current.state].includes(next)) throw new ConflictException({ code: "telephony_transition_invalid", from: current.state, to: next });
    const event = this.event(callId, input.idempotencyKey, "STATE", next, occurredAt, principal.userId, input.reasonCode); const answeredAt = next === "ANSWERED" ? occurredAt : current.answeredAt; const endedAt = ["ENDED", "FAILED", "MISSED", "CANCELLED"].includes(next) ? occurredAt : current.endedAt;
    const durationSeconds = answeredAt && endedAt ? Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(answeredAt)) / 1000)) : current.durationSeconds;
    if ((durationSeconds ?? 0) > this.config.maxCallDurationSeconds) throw new ConflictException({ code: "telephony_duration_threshold_exceeded" });
    const updated = Object.freeze({ ...current, state: next, ...(answeredAt ? { answeredAt } : {}), ...(endedAt ? { endedAt } : {}), ...(durationSeconds !== undefined ? { durationSeconds } : {}), recording: { ...current.recording, ...(durationSeconds !== undefined ? { durationSeconds } : {}) }, events: [...current.events, event] }); this.calls.set(callId, updated); this.eventReceipts.set(input.idempotencyKey, event);
    if (volatileEvidence && updated.leadId) this.leads.addActivity(updated.leadId, { type: "CRM_CALL", result: `CALL_${next}` }, principal, correlationId);
    if (volatileEvidence) this.audit.record({ eventType: "TELEPHONY_CALL_STATE_CHANGED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, before: { callId, state: current.state }, after: { callId, state: next, durationSeconds }, result: "SUCCESS", idempotencyKey: `telephony-event:${input.idempotencyKey}` }); return this.copy(updated);
  }

  compensate(callId: string, input: { idempotencyKey?: string; reasonCode?: string }, principal: Principal, correlationId: string): CallRecord {
    if (!principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) throw new ForbiddenException({ code: "telephony_compensation_forbidden" });
    const current = this.requiredCall(callId, principal, correlationId); if (!input.idempotencyKey || !/^[A-Za-z0-9_-]{8,160}$/.test(input.idempotencyKey) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode ?? "")) throw new BadRequestException({ code: "telephony_compensation_invalid" });
    const receipt = this.eventReceipts.get(input.idempotencyKey); if (receipt) return this.copy(current);
    const event = this.event(callId, input.idempotencyKey, "COMPENSATION", current.state, new Date().toISOString(), principal.userId, input.reasonCode); const updated = Object.freeze({ ...current, events: [...current.events, event] }); this.calls.set(callId, updated); this.eventReceipts.set(input.idempotencyKey, event);
    if (current.leadId) this.leads.addActivity(current.leadId, { type: "CORRECTION", result: "CALL_METADATA_COMPENSATED" }, principal, correlationId); return this.copy(updated);
  }

  confirmAssociation(callId: string, leadId: string, principal: Principal, correlationId: string): CallRecord {
    if (!principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) throw new ForbiddenException({ code: "telephony_association_forbidden" });
    const current = this.requiredCall(callId, principal, correlationId); if (current.leadId || !["UNMATCHED", "AMBIGUOUS"].includes(current.matchState)) throw new ConflictException({ code: "telephony_association_already_resolved" });
    const lead = this.scopedLead(leadId, principal, correlationId); if (!lead.phone || this.fingerprint(this.normalizePhone(lead.phone)) !== current.phoneFingerprint) throw new ConflictException({ code: "telephony_association_phone_mismatch" });
    const event = this.event(callId, `association:${callId}:${leadId}`, "COMPENSATION", current.state, new Date().toISOString(), principal.userId, "ASSOCIATION_CONFIRMED");
    const updated = Object.freeze({ ...current, leadId, matchState: "CONFIRMED" as const, events: [...current.events, event] }); this.calls.set(callId, updated); this.eventReceipts.set(event.idempotencyKey, event); this.leads.addActivity(leadId, { type: "CRM_CALL", result: `CALL_${current.state}` }, principal, correlationId); this.audit.record({ eventType: "TELEPHONY_ASSOCIATION_CONFIRMED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { callId, leadId, matchState: "CONFIRMED" }, result: "SUCCESS", idempotencyKey: event.idempotencyKey }); return this.copy(updated);
  }

  call(callId: string, principal: Principal, correlationId: string): CallRecord { return this.copy(this.requiredCall(callId, principal, correlationId)); }
  queue(principal: Principal): { missed: CallRecord[]; toVerify: CallRecord[] } { this.assertContributor(principal); const all = [...this.calls.values()].filter((call) => this.canAccessCall(call, principal)); return { missed: all.filter((call) => call.state === "MISSED").map((call) => this.copy(call)), toVerify: all.filter((call) => call.matchState === "UNMATCHED" || call.matchState === "AMBIGUOUS").map((call) => this.copy(call)) }; }
  recording(callId: string, principal: Principal, correlationId: string): RecordingMetadata {
    const call = this.requiredCall(callId, principal, correlationId); if (!principal.roles.some((role) => call.recording.authorizedRoles.includes(role))) throw new NotFoundException({ code: "recording_not_found" });
    this.audit.record({ eventType: "TELEPHONY_RECORDING_METADATA_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { callId, recordingId: call.recording.recordingId, state: call.recording.state }, result: "SUCCESS", idempotencyKey: `recording-view:${call.recording.recordingId}:${principal.userId}:${correlationId}` }); return { ...call.recording, authorizedRoles: [...call.recording.authorizedRoles] };
  }
  webhookStatus(): { enabled: false; reason: "secure_configuration_required" } { return { enabled: false, reason: "secure_configuration_required" }; }
  rejectRealWebhook(): never { throw new ServiceUnavailableException({ code: "telephony_webhook_disabled" }); }
  verifySyntheticSignature(payload: string, timestamp: string, signature: string, syntheticSecret: string): boolean {
    if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature) || !syntheticSecret.startsWith("synthetic-")) return false;
    const expected = `sha256=${createHmac("sha256", syntheticSecret).update(`${timestamp}.${payload}`).digest("hex")}`; return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  private createCall(input: { provider: TelephonyProvider; externalId: string; direction: CallDirection; leadId?: string; phone: string; matchState: MatchState; principal: Principal; idempotencyKey: string; correlationId: string; occurredAt?: string; dispatchState?: DispatchState }): CallRecord {
    const key = `${input.provider}:${input.externalId}`; const existing = this.callByProviderId.get(key); if (existing) return this.copy(this.calls.get(existing)!);
    const occurredAt = this.timestamp(input.occurredAt, "telephony_call_timestamp_invalid"); const id = randomUUID(); const event = this.event(id, input.idempotencyKey, "STATE", "REQUESTED", occurredAt, input.principal.userId);
    const recording: RecordingMetadata = { recordingId: randomUUID(), state: "UNAVAILABLE", provider: input.provider, authorizedRoles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] };
    const call: Readonly<CallRecord> = Object.freeze({ id, provider: input.provider, externalId: input.externalId, direction: input.direction, state: "REQUESTED", ...(input.leadId ? { leadId: input.leadId } : {}), phoneFingerprint: this.fingerprint(input.phone), maskedPhone: this.mask(input.phone), dispatchState: input.dispatchState ?? "ACCEPTED", dispatchUpdatedAt: occurredAt, matchState: input.matchState, requestedAt: occurredAt, createdBy: input.principal.userId, recording, events: [event] });
    this.calls.set(id, call); this.callByProviderId.set(key, id); this.eventReceipts.set(input.idempotencyKey, event); if (input.leadId) this.leads.addActivity(input.leadId, { type: "CRM_CALL", result: "CALL_REQUESTED" }, input.principal, input.correlationId);
    this.audit.record({ eventType: "TELEPHONY_CALL_REQUESTED", actorId: input.principal.userId, actorRoles: input.principal.roles, sessionId: input.principal.sessionId, correlationId: input.correlationId, after: { callId: id, provider: input.provider, direction: input.direction, matchState: input.matchState }, result: "SUCCESS", idempotencyKey: `telephony-call:${input.provider}:${input.externalId}` }); return this.copy(call);
  }
  private event(callId: string, idempotencyKey: string, eventType: "STATE" | "COMPENSATION", state: CallState, occurredAt: string, actorId?: string, reasonCode?: string): CallEvent { return Object.freeze({ id: randomUUID(), callId, idempotencyKey, eventType, state, ...(reasonCode ? { reasonCode } : {}), ...(actorId ? { actorId } : {}), occurredAt, receivedAt: new Date().toISOString() }); }
  private requiredCall(id: string, principal: Principal, correlationId: string): Readonly<CallRecord> { const call = this.calls.get(id); if (!call) throw new NotFoundException({ code: "telephony_call_not_found" }); if (call.leadId) this.scopedLead(call.leadId, principal, correlationId); return call; }
  private scopedLead(id: string, principal: Principal, correlationId: string): LeadRecord { const lead = this.leads.getLead(id, principal, correlationId); if (!principal.scopes.some((scope) => scope.kind === "GLOBAL" || (scope.kind === "CAMPUS" && scope.id === lead.campus))) throw new NotFoundException({ code: "lead_not_found" }); return lead; }
  private assertContributor(principal: Principal): void { if (!principal.roles.some((role) => contributorRoles.includes(role))) throw new ForbiddenException({ code: "telephony_role_forbidden" }); }
  private canAccessCall(call: Readonly<CallRecord>, principal: Principal): boolean {
    if (!call.leadId) return call.createdBy === principal.userId || principal.roles.includes("SUPER_ADMIN");
    try { this.scopedLead(call.leadId, principal, "telephony-queue"); return true; } catch { return false; }
  }
  private normalizePhone(value: string): string { const normalized = value.replace(/[^+\d]/g, ""); if (!/^\+?\d{8,15}$/.test(normalized)) throw new BadRequestException({ code: "telephony_phone_invalid" }); return normalized; }
  private fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }
  private mask(value: string): string { return `***${value.replace(/\D/g, "").slice(-3)}`; }
  private timestamp(value: string | undefined, code: string): string { const date = value ? new Date(value) : new Date(); if (Number.isNaN(date.valueOf())) throw new BadRequestException({ code }); return date.toISOString(); }
  private copy(call: Readonly<CallRecord>): CallRecord { return structuredClone(call); }

  private assertOutboundInput(leadId: string, input: { idempotencyKey?: string }, principal: Principal, correlationId: string): void {
    this.assertContributor(principal); this.scopedLead(leadId, principal, correlationId);
    if (!input.idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "telephony_idempotency_invalid" });
    if (this.config.mode === "DISABLED" || !this.config.outboundEnabled || !this.config.clickToCallEnabled) throw new ServiceUnavailableException({ code: "telephony_provider_disabled" });
  }

  private bridgePrincipal(): Principal { return { userId: "linphone-bridge", roles: [], scopes: [], sessionId: "linphone-bridge" }; }

  private verifyBridgeRequest(body: TelephonyBridgeEvent, headers: { bridgeId: string; timestamp: string; nonce: string; signature: string }): void {
    const secret = process.env.TELEPHONY_LINPHONE_BRIDGE_SECRET?.trim() ?? "";
    const configuredBridgeId = process.env.TELEPHONY_LINPHONE_BRIDGE_ID?.trim() ?? "";
    if (secret.length < 32 || !/^[A-Za-z0-9_-]{8,64}$/.test(configuredBridgeId)) throw new ServiceUnavailableException({ code: "telephony_bridge_not_configured" });
    if (!/^\d{13}$/.test(headers.timestamp) || !/^[0-9a-f-]{36}$/iu.test(headers.nonce) || !/^sha256=[a-f0-9]{64}$/.test(headers.signature)
      || headers.bridgeId !== configuredBridgeId || Math.abs(Date.now() - Number(headers.timestamp)) > 300_000) throw new ForbiddenException({ code: "telephony_bridge_authentication_refused" });
    const expected = `sha256=${createHmac("sha256", secret).update(`${headers.bridgeId}.${headers.timestamp}.${headers.nonce}.${canonicalizeBridgePayload(body)}`).digest("hex")}`;
    const expectedBuffer = Buffer.from(expected); const received = Buffer.from(headers.signature);
    if (expectedBuffer.length !== received.length || !timingSafeEqual(expectedBuffer, received)) throw new ForbiddenException({ code: "telephony_bridge_authentication_refused" });
  }

  private async preparePersistentMutation(): Promise<void> { await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); }
  private async refreshAfterPersistentMutation(): Promise<void> { await this.leads.refreshReportingForApi(); await this.refreshPersistentState(); }
  private async refreshPersistentState(): Promise<void> {
    if (!this.persistence?.enabled) return;
    const snapshot = await this.persistence.snapshot();
    if (snapshot.configuration) this.config = Object.freeze({ ...snapshot.configuration });
    this.calls.clear(); this.callByProviderId.clear(); this.eventReceipts.clear();
    for (const call of snapshot.calls) {
      const frozen = Object.freeze({ ...call, recording: { ...call.recording, authorizedRoles: [...call.recording.authorizedRoles] }, events: call.events.map((event) => ({ ...event })) });
      this.calls.set(call.id, frozen); this.callByProviderId.set(`${call.provider}:${call.externalId}`, call.id);
      const first = call.events[0]; if (first) this.callByProviderId.set(`${call.provider}:request:${first.idempotencyKey}`, call.id);
      for (const event of call.events) this.eventReceipts.set(event.idempotencyKey, event);
    }
  }
}
