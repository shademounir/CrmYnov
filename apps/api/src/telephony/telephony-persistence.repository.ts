import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { CallEvent, CallRecord, TelephonyConfiguration } from "./telephony.service.js";

type CallRow = Prisma.TelephonyCallGetPayload<{ include: { events: true; recording: true } }>;
const configurationId = "00000000-0000-4000-8000-000000000165";

export interface TelephonySnapshot { configuration?: TelephonyConfiguration; calls: CallRecord[] }

@Injectable()
export class TelephonyPersistenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get enabled(): boolean { return this.prisma.enabled && Boolean(this.prisma.client); }

  async permissionLeadId(id: string): Promise<string | null | undefined> {
    const row = await this.requiredClient().telephonyCall.findUnique({ where: { id }, select: { leadId: true } });
    return row ? row.leadId : undefined;
  }

  async snapshot(): Promise<TelephonySnapshot> {
    const client = this.requiredClient();
    const [configuration, calls] = await Promise.all([
      client.telephonyConfiguration.findFirst({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
      client.telephonyCall.findMany({ include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }, recording: true }, orderBy: [{ requestedAt: "desc" }, { id: "asc" }] }),
    ]);
    return {
      ...(configuration ? { configuration: {
        mode: configuration.mode as TelephonyConfiguration["mode"], clickToCallEnabled: configuration.clickToCallEnabled,
        inboundEnabled: configuration.inboundEnabled, outboundEnabled: configuration.outboundEnabled,
        recordingPolicy: configuration.recordingPolicy as TelephonyConfiguration["recordingPolicy"],
        maxCallDurationSeconds: configuration.maxCallDurationSeconds,
        ...(configuration.providerConfigurationRef ? { secretReference: configuration.providerConfigurationRef } : {}),
        version: configuration.version, updatedBy: configuration.updatedBy, updatedAt: configuration.updatedAt.toISOString(), webhookEnabled: false,
      } } : {}),
      calls: calls.map((row) => this.mapCall(row)),
    };
  }

  async persistConfiguration(configuration: TelephonyConfiguration, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
      const current = await tx.telephonyConfiguration.findUnique({ where: { id: configurationId } });
      if (!current) {
        await tx.telephonyConfiguration.create({ data: {
          id: configurationId, mode: configuration.mode, clickToCallEnabled: configuration.clickToCallEnabled,
          inboundEnabled: configuration.inboundEnabled, outboundEnabled: configuration.outboundEnabled,
          recordingPolicy: configuration.recordingPolicy, maxCallDurationSeconds: configuration.maxCallDurationSeconds,
          providerConfigurationRef: configuration.secretReference ?? null, version: configuration.version, updatedBy: configuration.updatedBy,
        } });
      } else {
        const changed = await tx.telephonyConfiguration.updateMany({ where: { id: configurationId, version: configuration.version - 1 }, data: {
          mode: configuration.mode, clickToCallEnabled: configuration.clickToCallEnabled, inboundEnabled: configuration.inboundEnabled,
          outboundEnabled: configuration.outboundEnabled, recordingPolicy: configuration.recordingPolicy,
          maxCallDurationSeconds: configuration.maxCallDurationSeconds, providerConfigurationRef: configuration.secretReference ?? null,
          version: configuration.version, updatedBy: configuration.updatedBy,
        } });
        if (changed.count !== 1) throw new ConflictException({ code: "telephony_configuration_version_conflict" });
      }
      await this.audit(tx, "TELEPHONY_CONFIGURATION_CHANGED", "TELEPHONY_CONFIGURATION", configurationId, principal, correlationId, `telephony-config:${configuration.version}`, { mode: configuration.mode, version: configuration.version, recordingPolicy: configuration.recordingPolicy });
    }, { isolationLevel: "Serializable" });
  }

  async persistCreate(record: CallRecord, event: CallEvent, principal: Principal, correlationId: string): Promise<boolean> {
    const client = this.requiredClient();
    try {
      return await client.$transaction(async (tx) => {
        if (await tx.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return false;
        await tx.telephonyRecordingMetadata.create({ data: {
          id: record.recording.recordingId, provider: record.recording.provider, state: record.recording.state,
          durationSeconds: record.recording.durationSeconds ?? null, storageReference: record.recording.storageReference ?? null,
          authorizedRoles: record.recording.authorizedRoles,
        } });
        await tx.telephonyCall.create({ data: {
          id: record.id, provider: record.provider, externalId: record.externalId, direction: record.direction, state: record.state,
          leadId: record.leadId ?? null, phoneFingerprint: record.phoneFingerprint, maskedPhone: record.maskedPhone,
          dispatchState: record.dispatchState, dispatchErrorCode: record.dispatchErrorCode ?? null,
          dispatchUpdatedAt: record.dispatchUpdatedAt ? new Date(record.dispatchUpdatedAt) : null,
          matchState: record.matchState, requestedAt: new Date(record.requestedAt), answeredAt: record.answeredAt ? new Date(record.answeredAt) : null,
          endedAt: record.endedAt ? new Date(record.endedAt) : null, durationSeconds: record.durationSeconds ?? null,
          createdBy: record.createdBy, recordingId: record.recording.recordingId,
        } });
        await this.event(tx, event);
        if (record.leadId) await this.activity(tx, record.leadId, "CRM_CALL", "CALL_REQUESTED", event, principal, correlationId);
        await this.audit(tx, "TELEPHONY_CALL_REQUESTED", "TELEPHONY_CALL", record.id, principal, correlationId, event.idempotencyKey, { callId: record.id, provider: record.provider, direction: record.direction, matchState: record.matchState });
        return true;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return false;
      throw error;
    }
  }

  async persistDispatch(callId: string, expectedState: CallRecord["dispatchState"], state: CallRecord["dispatchState"], errorCode?: string): Promise<void> {
    const changed = await this.requiredClient().telephonyCall.updateMany({ where: { id: callId, dispatchState: expectedState }, data: {
      dispatchState: state, dispatchErrorCode: errorCode ?? null, dispatchUpdatedAt: new Date(),
    } });
    if (changed.count !== 1) throw new ConflictException({ code: "telephony_dispatch_state_conflict" });
  }

  async callIdForCommand(commandId: string): Promise<string | undefined> {
    const row = await this.requiredClient().telephonyCall.findUnique({ where: { provider_externalId: { provider: "LINPHONE", externalId: commandId } }, select: { id: true } });
    return row?.id;
  }

  async persistTransition(previous: CallRecord, record: CallRecord, event: CallEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    try {
      await client.$transaction(async (tx) => {
        if (await tx.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
        const changed = await tx.telephonyCall.updateMany({ where: { id: record.id, state: previous.state }, data: {
          state: record.state, answeredAt: record.answeredAt ? new Date(record.answeredAt) : null,
          endedAt: record.endedAt ? new Date(record.endedAt) : null, durationSeconds: record.durationSeconds ?? null,
        } });
        if (changed.count !== 1) throw new ConflictException({ code: "telephony_transition_invalid" });
        await this.event(tx, event);
        await tx.telephonyRecordingMetadata.update({ where: { id: record.recording.recordingId }, data: { durationSeconds: record.recording.durationSeconds ?? null } });
        if (record.leadId) await this.activity(tx, record.leadId, "CRM_CALL", `CALL_${record.state}`, event, principal, correlationId);
        await this.audit(tx, "TELEPHONY_CALL_STATE_CHANGED", "TELEPHONY_CALL", record.id, principal, correlationId, event.idempotencyKey, { callId: record.id, state: record.state, durationSeconds: record.durationSeconds });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      throw error;
    }
  }

  async persistCompensation(record: CallRecord, event: CallEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    try {
      await client.$transaction(async (tx) => {
        if (await tx.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
        await this.event(tx, event);
        if (record.leadId) await this.activity(tx, record.leadId, "CORRECTION", "CALL_METADATA_COMPENSATED", event, principal, correlationId);
        await this.audit(tx, "TELEPHONY_CALL_COMPENSATED", "TELEPHONY_CALL", record.id, principal, correlationId, event.idempotencyKey, { callId: record.id, state: record.state, reasonCode: event.reasonCode });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      throw error;
    }
  }

  async persistAssociation(previous: CallRecord, record: CallRecord, event: CallEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    if (!record.leadId) throw new Error("telephony_association_lead_missing");
    const leadId = record.leadId;
    await client.$transaction(async (tx) => {
      if (await tx.telephonyCallEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      const changed = await tx.telephonyCall.updateMany({ where: { id: record.id, leadId: null, matchState: previous.matchState }, data: { leadId, matchState: record.matchState } });
      if (changed.count !== 1) throw new ConflictException({ code: "telephony_association_already_resolved" });
      await this.event(tx, event);
      await this.activity(tx, leadId, "CRM_CALL", `CALL_${record.state}`, event, principal, correlationId);
      await this.audit(tx, "TELEPHONY_ASSOCIATION_CONFIRMED", "TELEPHONY_CALL", record.id, principal, correlationId, event.idempotencyKey, { callId: record.id, leadId, matchState: record.matchState });
    }, { isolationLevel: "Serializable" });
  }

  async persistRecordingAccess(record: CallRecord, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
      const key = `telephony-recording-view:${record.recording.recordingId}:${principal.userId}:${correlationId}`;
      if (await tx.auditEvent.findUnique({ where: { idempotencyKey: key } })) return;
      await tx.telephonyRecordingAccessEvent.create({ data: { id: randomUUID(), recordingId: record.recording.recordingId, actorId: principal.userId, outcome: "METADATA_VIEWED" } });
      await this.audit(tx, "TELEPHONY_RECORDING_METADATA_VIEWED", "TELEPHONY_RECORDING", record.recording.recordingId, principal, correlationId, key, { callId: record.id, recordingId: record.recording.recordingId, state: record.recording.state });
    }, { isolationLevel: "Serializable" });
  }

  private mapCall(row: CallRow): CallRecord {
    const recording = row.recording;
    if (!recording) throw new Error("telephony_recording_missing");
    return {
      id: row.id, provider: row.provider as CallRecord["provider"], externalId: row.externalId,
      direction: row.direction as CallRecord["direction"], state: row.state as CallRecord["state"],
      ...(row.leadId ? { leadId: row.leadId } : {}), phoneFingerprint: row.phoneFingerprint, maskedPhone: row.maskedPhone,
      dispatchState: row.dispatchState as CallRecord["dispatchState"], ...(row.dispatchErrorCode ? { dispatchErrorCode: row.dispatchErrorCode } : {}),
      ...(row.dispatchUpdatedAt ? { dispatchUpdatedAt: row.dispatchUpdatedAt.toISOString() } : {}),
      matchState: row.matchState as CallRecord["matchState"], requestedAt: row.requestedAt.toISOString(),
      ...(row.answeredAt ? { answeredAt: row.answeredAt.toISOString() } : {}), ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      ...(row.durationSeconds !== null ? { durationSeconds: row.durationSeconds } : {}), createdBy: row.createdBy,
      recording: { recordingId: recording.id, state: recording.state as CallRecord["recording"]["state"],
        ...(recording.durationSeconds !== null ? { durationSeconds: recording.durationSeconds } : {}), provider: recording.provider as CallRecord["provider"],
        ...(recording.storageReference ? { storageReference: recording.storageReference } : {}), authorizedRoles: recording.authorizedRoles as CallRecord["recording"]["authorizedRoles"] },
      events: row.events.map((event) => ({ id: event.id, callId: event.callId, idempotencyKey: event.idempotencyKey,
        eventType: event.eventType as CallEvent["eventType"], state: event.state as CallEvent["state"],
        ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}), ...(event.actorId ? { actorId: event.actorId } : {}),
        occurredAt: event.occurredAt.toISOString(), receivedAt: event.receivedAt.toISOString() })),
    };
  }

  private async event(tx: Prisma.TransactionClient, event: CallEvent): Promise<void> {
    await tx.telephonyCallEvent.create({ data: { id: event.id, callId: event.callId, idempotencyKey: event.idempotencyKey,
      eventType: event.eventType, state: event.state, reasonCode: event.reasonCode ?? null, actorId: event.actorId ?? null,
      occurredAt: new Date(event.occurredAt), receivedAt: new Date(event.receivedAt) } });
  }

  private async activity(tx: Prisma.TransactionClient, leadId: string, type: string, result: string, event: CallEvent, principal: Principal, correlationId: string): Promise<void> {
    await tx.leadActivity.create({ data: { leadId, type, result, authorId: principal.userId, correlationId,
      idempotencyKey: `telephony-activity:${this.hash(event.idempotencyKey)}`, occurredAt: new Date(event.occurredAt) } });
    await tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: new Date(event.occurredAt), version: { increment: 1 } } });
  }

  private async audit(tx: Prisma.TransactionClient, eventType: string, resourceType: string, resourceId: string, principal: Principal, correlationId: string, key: string, after: Prisma.InputJsonObject): Promise<void> {
    await tx.auditEvent.create({ data: { eventType, resourceType, resourceId, actorId: principal.userId, actorRoles: principal.roles,
      ...(this.uuid(principal.sessionId) ? { sessionId: principal.sessionId } : {}), correlationId, after, result: "SUCCESS",
      idempotencyKey: key.startsWith("telephony-") ? key : `telephony-audit:${this.hash(key)}` } });
  }

  private hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
  private uuid(value: string | undefined): boolean { return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)); }
  private prismaCode(error: unknown): string { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""; }
  private requiredClient(): NonNullable<PrismaService["client"]> { if (!this.prisma.client) throw new Error("telephony_persistence_unavailable"); return this.prisma.client; }
}
