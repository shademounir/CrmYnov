import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { AppointmentEvent, AppointmentRecord, InterviewReport } from "./appointment.service.js";

type AppointmentRow = Prisma.AppointmentGetPayload<{
  include: { participants: true; events: true; interviewReports: true };
}>;

export interface AppointmentSnapshot {
  items: AppointmentRecord[];
  events: AppointmentEvent[];
  reports: InterviewReport[];
}

@Injectable()
export class AppointmentPersistenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  async permissionLeadId(id: string): Promise<string | undefined> {
    return (await this.requiredClient().appointment.findUnique({ where: { id }, select: { leadId: true } }))?.leadId;
  }

  async snapshot(): Promise<AppointmentSnapshot> {
    const rows = await this.requiredClient().appointment.findMany({
      include: { participants: true, events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }, interviewReports: { orderBy: [{ validatedAt: "asc" }, { id: "asc" }] } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return {
      items: rows.map((row) => this.mapAppointment(row)),
      events: rows.flatMap((row) => row.events.map((event) => ({
        id: event.id, appointmentId: event.appointmentId, type: event.eventType,
        ...(event.fromState ? { fromState: event.fromState as NonNullable<AppointmentEvent["fromState"]> } : {}),
        ...(event.toState ? { toState: event.toState as NonNullable<AppointmentEvent["toState"]> } : {}),
        actorId: event.actorId, ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
        occurredAt: event.occurredAt.toISOString(), idempotencyKey: event.idempotencyKey,
        ...(event.compensatesEventId ? { compensatesEventId: event.compensatesEventId } : {}),
      }))),
      reports: rows.flatMap((row) => row.interviewReports.map((report) => ({
        id: report.id, appointmentId: report.appointmentId, result: report.result as InterviewReport["result"],
        comment: report.redactedComment, ...(report.redactedMissingPoints ? { missingPoints: report.redactedMissingPoints } : {}),
        ...(report.nextAction ? { nextAction: report.nextAction } : {}), ...(report.followUpAt ? { followUpAt: report.followUpAt.toISOString() } : {}),
        recommendation: report.redactedRecommendation, validatedAt: report.validatedAt.toISOString(), validatedBy: report.validatedBy,
        ...(report.compensatesReportId ? { compensatesReportId: report.compensatesReportId } : {}),
      }))),
    };
  }

  async persistCreate(record: AppointmentRecord, event: AppointmentEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    try {
      await client.$transaction(async (tx) => {
        if (await tx.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
        await tx.appointment.create({ data: {
          id: record.id, leadId: record.leadId, type: record.type, mode: record.mode, state: record.state,
          startsAt: new Date(record.startsAt), durationMinutes: record.durationMinutes, campus: record.campus ?? null,
          adviserId: record.adviserId, organizerId: record.organizerId, evaluatorId: record.evaluatorId ?? null,
          version: record.version, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
          participants: { create: record.participantIds.map((userId) => ({ userId, role: "PARTICIPANT" })) },
        } });
        await this.persistEvent(tx, event);
        await this.persistLeadActivity(tx, record, event, principal, correlationId);
        await this.persistAudit(tx, record, event.type, principal, correlationId, event.idempotencyKey);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      throw error;
    }
  }

  async persistTransition(record: AppointmentRecord, event: AppointmentEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    try {
      await client.$transaction(async (tx) => {
        if (await tx.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
        const changed = await tx.appointment.updateMany({
          where: { id: record.id, version: record.version - 1 },
          data: { state: record.state, startsAt: new Date(record.startsAt), version: record.version, updatedAt: new Date(record.updatedAt) },
        });
        if (changed.count !== 1) throw new ConflictException({ code: "appointment_transition_refused" });
        await this.persistEvent(tx, event);
        await this.persistLeadActivity(tx, record, event, principal, correlationId, undefined, ["ANNULE", "REALISE", "ABSENT", "REFUSE"].includes(record.state));
        await this.persistAudit(tx, record, event.type, principal, correlationId, event.idempotencyKey);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      throw error;
    }
  }

  async persistCompensation(record: AppointmentRecord, event: AppointmentEvent, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    try {
      await client.$transaction(async (tx) => {
        if (await tx.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
        await this.persistEvent(tx, event);
        await this.persistAudit(tx, record, "APPOINTMENT_COMPENSATED", principal, correlationId, event.idempotencyKey);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002" && await client.appointmentEvent.findUnique({ where: { idempotencyKey: event.idempotencyKey } })) return;
      throw error;
    }
  }

  async persistReport(record: AppointmentRecord, report: InterviewReport, principal: Principal, correlationId: string): Promise<void> {
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
      const existing = await tx.interviewReport.findFirst({ where: { appointmentId: record.id }, orderBy: [{ validatedAt: "asc" }, { id: "asc" }] });
      if (existing) return;
      await tx.interviewReport.create({ data: {
        id: report.id, appointmentId: report.appointmentId, result: report.result, redactedComment: report.comment,
        redactedMissingPoints: report.missingPoints ?? null, nextAction: report.nextAction ?? null,
        followUpAt: report.followUpAt ? new Date(report.followUpAt) : null,
        redactedRecommendation: report.recommendation, validatedBy: report.validatedBy,
        validatedAt: new Date(report.validatedAt), compensatesReportId: report.compensatesReportId ?? null,
      } });
      const event: AppointmentEvent = {
        id: randomUUID(), appointmentId: record.id, type: "INTERVIEW_REPORT_VALIDATED", actorId: principal.userId,
        occurredAt: report.validatedAt, idempotencyKey: `interview-report-${report.id}`,
      };
      await this.persistLeadActivity(tx, record, event, principal, correlationId, report.followUpAt);
      await this.persistAudit(tx, record, event.type, principal, correlationId, event.idempotencyKey);
    }, { isolationLevel: "Serializable" });
  }

  private async persistEvent(tx: Prisma.TransactionClient, event: AppointmentEvent): Promise<void> {
    await tx.appointmentEvent.create({ data: {
      id: event.id, appointmentId: event.appointmentId, idempotencyKey: event.idempotencyKey, eventType: event.type,
      fromState: event.fromState ?? null, toState: event.toState ?? null, actorId: event.actorId, reasonCode: event.reasonCode ?? null,
      compensatesEventId: event.compensatesEventId ?? null, occurredAt: new Date(event.occurredAt),
    } });
  }

  private async persistLeadActivity(
    tx: Prisma.TransactionClient,
    record: AppointmentRecord,
    event: AppointmentEvent,
    principal: Principal,
    correlationId: string,
    explicitNextActionAt?: string,
    clearNextAction = false,
  ): Promise<void> {
    const nextActionAt = explicitNextActionAt ?? (["PLANIFIE", "CONFIRME", "REPORTE"].includes(record.state) ? record.startsAt : undefined);
    await tx.leadActivity.create({ data: {
      leadId: record.leadId, type: "MEETING", result: event.type === "APPOINTMENT_CREATED" ? `APPOINTMENT_${record.state}` : event.type, authorId: principal.userId,
      ...(nextActionAt ? { nextActionAt: new Date(nextActionAt) } : {}), correlationId,
      idempotencyKey: `appointment-activity-${this.hash(event.idempotencyKey)}`, occurredAt: new Date(event.occurredAt),
    } });
    await tx.lead.update({ where: { id: record.leadId }, data: {
      lastActivityAt: new Date(event.occurredAt), ...(nextActionAt ? { nextActionAt: new Date(nextActionAt) } : clearNextAction ? { nextActionAt: null } : {}), version: { increment: 1 },
    } });
  }

  private async persistAudit(
    tx: Prisma.TransactionClient,
    record: AppointmentRecord,
    eventType: string,
    principal: Principal,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await tx.auditEvent.create({ data: {
      eventType, campusId: record.campus ?? null, resourceType: "APPOINTMENT", resourceId: record.id,
      actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId,
      after: { appointmentId: record.id, leadId: record.leadId, type: record.type, mode: record.mode, state: record.state, startsAt: record.startsAt, durationMinutes: record.durationMinutes, campus: record.campus, version: record.version },
      result: "SUCCESS", idempotencyKey: `appointment-audit-${this.hash(idempotencyKey)}`,
    } });
  }

  private mapAppointment(row: AppointmentRow): AppointmentRecord {
    return {
      id: row.id, leadId: row.leadId, type: row.type as AppointmentRecord["type"], mode: row.mode as AppointmentRecord["mode"],
      state: row.state as AppointmentRecord["state"], startsAt: row.startsAt.toISOString(), durationMinutes: row.durationMinutes,
      ...(row.campus ? { campus: row.campus } : {}), adviserId: row.adviserId, organizerId: row.organizerId,
      ...(row.evaluatorId ? { evaluatorId: row.evaluatorId } : {}), participantIds: row.participants.map((participant) => participant.userId).sort((left, right) => left.localeCompare(right)),
      version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      conflictWarning: false, overloadWarning: false,
    };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private prismaCode(error: unknown): string {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("appointment_persistence_unavailable");
    return this.prisma.client;
  }
}
