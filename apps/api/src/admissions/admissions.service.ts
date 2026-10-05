import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdmissionsResponsibility, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { canonicalCampus, leadResource } from "../permissions/dynamic-resources.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { appointmentModes, appointmentTypes, interviewResults } from "../appointments/appointment.service.js";
import { appointmentOccupations, assertAppointmentFree, lockAppointmentParticipants } from "../appointments/appointment-locks.js";
import { assertDuration, assertKey, assertUuid, assertVersion, freeSlots, hashAdmissions, instant, interval, invalidAdmissions, strictInput, type AdmissionsReportInput, type BookingDecisionInput, type BookingInput, type BookingView, type ResponsibilityInput, type ResponsibilityView, type WindowInput, type WindowView, type WithdrawWindowInput } from "./admissions.contract.js";

type Tx = Prisma.TransactionClient;
type Profile = Prisma.AdmissionsResponsibilityGetPayload<{ include: { user: true } }>;
type BookingRow = Prisma.AdmissionsBookingGetPayload<{ include: { responsibility: { include: { user: true } }; appointment: { include: { lead: true; participants: true; interviewReports: true } } } }>;
type Campus = { id: string; code: string; label: string; keys: string[] };
type AccessibleCampus = Campus & { canManage: boolean; canUseAgenda: boolean };
type BookingCursor = { startsAt: Date; id: string };
const bookingInclude = { responsibility: { include: { user: true } }, appointment: { include: { lead: true, participants: true, interviewReports: true } } } as const;
const terminal = new Set(["ANNULE", "REALISE", "ABSENT", "REFUSE"]);

/** PostgreSQL-only service. Never advertises a simulated in-memory booking as persisted. */
@Injectable()
export class AdmissionsService {
  // These caches live only as long as a fenced transaction, never across requests/revocations.
  private readonly snapshotCache = new WeakMap<Tx, ReturnType<DynamicPermissionRepository["snapshots"]>>();
  private readonly campusCache = new WeakMap<Tx, Map<string, Promise<Campus>>>();
  constructor(@Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository) {}

  private transaction<T>(principal: Principal, read: boolean, action: (tx: Tx, current: Principal) => Promise<T>): Promise<T> {
    return this.permissions.transaction(async (tx) => {
      const current = await currentPrincipal(tx, principal);
      if (current.mustChangeSecret || !current.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS"].includes(role))) this.denied();
      return action(tx, current);
    }, read ? "read" : "write");
  }

  async context(principal: Principal, requestedCampus?: string): Promise<{ timezone: "Africa/Casablanca"; ownResponsibilities: ResponsibilityView[]; canManageResponsibilities: boolean; canUseAgenda: boolean; campuses: Array<{ id: string; code: string; label: string; canManageResponsibilities: boolean }>; eligibleUsers: Array<{ id: string; label: string; campus: string }> }> {
    return this.transaction(principal, true, async (tx, actor) => {
      const accessible = await this.accessibleCampuses(tx, actor, requestedCampus);
      const campuses = accessible.map(({ id, code, label, canManage }) => ({ id, code, label, canManageResponsibilities: canManage }));
      const managed = accessible.filter((campus) => campus.canManage);
      const canUseAgenda = accessible.some((campus) => campus.canUseAgenda);
      const profiles = await tx.admissionsResponsibility.findMany({ where: { userId: actor.userId, active: true, campus: { in: campuses.map((item) => item.code) } }, include: { user: true } });
      const users = managed.length ? await tx.collaborator.findMany({ where: { active: true, firstLoginRequired: false, campusId: { in: managed.flatMap((item) => item.keys) } }, orderBy: { professionalDisplayName: "asc" } }) : [];
      const ownResponsibilities: ResponsibilityView[] = [];
      for (const profile of profiles) if (this.profileActive(profile) && accessible.find((campus) => campus.code === profile.campus)?.canUseAgenda) ownResponsibilities.push(this.profileView(profile, campuses.find((campus) => campus.code === profile.campus)?.label));
      return { timezone: "Africa/Casablanca", ownResponsibilities, canManageResponsibilities: managed.length > 0, canUseAgenda,
        campuses, eligibleUsers: users.filter((user) => user.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN"].includes(role))).map((user) => ({ id: user.id, label: user.professionalDisplayName?.trim() || "Collaborateur", campus: managed.find((item) => user.campusId && item.keys.includes(user.campusId))!.code })) };
    });
  }

  async responsibles(principal: Principal, leadId?: string, requestedCampus?: string): Promise<{ items: ResponsibilityView[] }> {
    return this.transaction(principal, true, async (tx, actor) => {
      const campus = leadId ? await this.authorizeLead(tx, actor, leadId) : await this.authorizeCampus(tx, actor, requestedCampus);
      const includeInactive = !leadId && await this.can(tx, actor, "settings.campus.manage", campus.keys);
      const profiles = await tx.admissionsResponsibility.findMany({ where: { campus: campus.code, ...(!includeInactive ? { active: true } : {}) }, include: { user: true }, orderBy: { userId: "asc" } });
      return { items: profiles.filter((profile) => (includeInactive || this.profileActive(profile)) && profile.user.campusId && campus.keys.includes(profile.user.campusId)).map((profile) => this.profileView(profile, campus.label)) };
    });
  }

  async configureResponsibility(input: ResponsibilityInput, principal: Principal, correlationId: string): Promise<ResponsibilityView> {
    strictInput(input, ["userId", "campus", "active", "expectedVersion", "idempotencyKey"]); assertUuid(input.userId); assertKey(input.idempotencyKey); assertVersion(input.expectedVersion, true); if (typeof input.active !== "boolean") invalidAdmissions();
    return this.transaction(principal, false, async (tx, actor) => {
      const campus = await this.campus(tx, input.campus);
      if (!await this.can(tx, actor, "settings.campus.manage", campus.keys)) this.denied();
      const target = await tx.collaborator.findUnique({ where: { id: input.userId } });
      if (!target || !target.active || target.firstLoginRequired || !target.campusId || !campus.keys.includes(target.campusId) || !target.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN"].includes(role))) this.denied();
      return this.mutation(tx, actor, "RESPONSIBILITY", { ...input, campus: campus.code }, async (key) => {
        await lockAppointmentParticipants(tx, [target.id]);
        const current = await tx.admissionsResponsibility.findUnique({ where: { userId_campus: { userId: target.id, campus: campus.code } } });
        if ((current?.version ?? 0) !== input.expectedVersion) this.versionConflict();
        const row = await tx.admissionsResponsibility.upsert({ where: { userId_campus: { userId: target.id, campus: campus.code } }, create: { userId: target.id, campus: campus.code, active: input.active }, update: { active: input.active, version: { increment: 1 } }, include: { user: true } });
        await this.audit(tx, actor, "ADMISSIONS_RESPONSIBILITY_CHANGED", row.id, campus.code, key, correlationId, { active: row.active, userId: row.userId, version: row.version });
        return this.profileView(row, campus.label);
      });
    });
  }

  async windows(principal: Principal, campusInput?: string): Promise<{ items: WindowView[]; timezone: "Africa/Casablanca" }> {
    return this.transaction(principal, true, async (tx, actor) => {
      const campuses = (await this.accessibleCampuses(tx, actor, campusInput)).filter((campus) => campus.canUseAgenda);
      if (!campuses.length) return { items: [], timezone: "Africa/Casablanca" };
      const profiles = await tx.admissionsResponsibility.findMany({ where: { active: true, OR: campuses.map((campus) => ({ campus: campus.code, ...(!campus.canManage ? { userId: actor.userId } : {}) })) }, include: { user: true }, orderBy: { campus: "asc" } });
      const ids: string[] = [];
      for (const profile of profiles) {
        const campus = campuses.find((item) => item.code === profile.campus);
        if (campus && this.profileActive(profile) && profile.user.campusId && campus.keys.includes(profile.user.campusId)) ids.push(profile.id);
      }
      const rows = await tx.admissionsWindow.findMany({ where: { responsibilityId: { in: ids } }, include: { responsibility: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
      return { items: rows.map((row) => ({ id: row.id, responsibilityId: row.responsibilityId, campus: row.responsibility.campus, kind: row.kind as WindowView["kind"], startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), version: row.version, active: row.active })), timezone: "Africa/Casablanca" };
    });
  }

  async createWindow(input: WindowInput, principal: Principal, correlationId: string): Promise<WindowView> {
    strictInput(input, ["responsibilityId", "kind", "startsAt", "endsAt", "idempotencyKey"]); assertUuid(input.responsibilityId); assertKey(input.idempotencyKey); if (!["AVAILABLE", "BLOCKED"].includes(input.kind)) invalidAdmissions();
    const range = interval(input.startsAt, input.endsAt, 7);
    return this.transaction(principal, false, async (tx, actor) => {
      const profile = await this.ownOrAdminProfile(tx, input.responsibilityId, actor);
      return this.mutation(tx, actor, "WINDOW_CREATE", { ...input, startsAt: range.from.toISOString(), endsAt: range.to.toISOString() }, async (key) => {
        if (range.to <= new Date()) invalidAdmissions();
        await lockAppointmentParticipants(tx, [profile.userId]);
        if (input.kind === "BLOCKED") await assertAppointmentFree(tx, [profile.userId], range.from, (range.to.valueOf() - range.from.valueOf()) / 60_000);
        const row = await tx.admissionsWindow.create({ data: { responsibilityId: profile.id, kind: input.kind, startsAt: range.from, endsAt: range.to } });
        await this.audit(tx, actor, "ADMISSIONS_WINDOW_CREATED", row.id, profile.campus, key, correlationId, { kind: row.kind, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), version: row.version });
        return { id: row.id, responsibilityId: profile.id, campus: profile.campus, kind: input.kind, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), version: row.version, active: row.active };
      });
    });
  }

  async withdrawWindow(id: string, input: WithdrawWindowInput, principal: Principal, correlationId: string): Promise<WindowView> {
    assertUuid(id); strictInput(input, ["active", "expectedVersion", "idempotencyKey"]); assertVersion(input.expectedVersion); assertKey(input.idempotencyKey); if (input.active !== false) invalidAdmissions();
    return this.transaction(principal, false, async (tx, actor) => {
      const row = await tx.admissionsWindow.findUnique({ where: { id } }); if (!row) this.notFound();
      const profile = await this.ownOrAdminProfile(tx, row.responsibilityId, actor);
      return this.mutation(tx, actor, "WINDOW_WITHDRAW", { id, ...input }, async (key) => {
        await lockAppointmentParticipants(tx, [profile.userId]);
        if (!row.active || row.version !== input.expectedVersion) this.versionConflict();
        if (row.kind === "AVAILABLE") {
          const occupied = await tx.admissionsBooking.findMany({ where: { responsibilityId: profile.id, state: { in: ["PENDING", "ACCEPTED"] }, appointment: { state: { notIn: [...terminal] }, startsAt: { lt: row.endsAt } } }, include: { appointment: true } });
          const remaining = await tx.admissionsWindow.findMany({ where: { responsibilityId: profile.id, active: true, kind: "AVAILABLE", id: { not: id } } });
          if (occupied.some((item) => item.appointment.startsAt.valueOf() + item.appointment.durationMinutes * 60_000 > row.startsAt.valueOf() && !remaining.some((other) => other.startsAt <= item.appointment.startsAt && other.endsAt.valueOf() >= item.appointment.startsAt.valueOf() + item.appointment.durationMinutes * 60_000))) throw new ConflictException({ code: "admissions_window_in_use" });
        }
        const changed = await tx.admissionsWindow.update({ where: { id, version: input.expectedVersion }, data: { active: false, version: { increment: 1 } } });
        await this.audit(tx, actor, "ADMISSIONS_WINDOW_WITHDRAWN", id, profile.campus, key, correlationId, { active: false, version: changed.version });
        return { id, responsibilityId: profile.id, campus: profile.campus, kind: changed.kind as WindowView["kind"], startsAt: changed.startsAt.toISOString(), endsAt: changed.endsAt.toISOString(), version: changed.version, active: false };
      });
    });
  }

  async slots(leadId: string, responsibilityId: string, from: string, to: string, durationMinutes: number, principal: Principal, bookingId?: string): Promise<{ items: Array<{ startsAt: string; endsAt: string }>; redacted: true; timezone: "Africa/Casablanca" }> {
    assertUuid(leadId); assertUuid(responsibilityId); assertDuration(durationMinutes); const range = interval(from, to, 7);
    if (bookingId) assertUuid(bookingId);
    return this.transaction(principal, true, async (tx, actor) => {
      const existing = bookingId ? await tx.admissionsBooking.findUnique({ where: { appointmentId: bookingId }, include: bookingInclude }) : undefined;
      if (bookingId && (!existing || existing.appointment.leadId !== leadId || existing.responsibilityId !== responsibilityId || !await this.canReadBooking(tx, existing, actor, (await this.campus(tx, existing.responsibility.campus)).keys))) this.denied();
      const campus = existing ? await this.campus(tx, existing.responsibility.campus) : await this.authorizeLead(tx, actor, leadId);
      const profile = await this.activeProfile(tx, responsibilityId, campus.code);
      const windows = await tx.admissionsWindow.findMany({ where: { responsibilityId: profile.id, active: true, startsAt: { lt: range.to }, endsAt: { gt: range.from } } });
      const occupied = await this.occupations(tx, existing ? this.involved(existing) : [profile.userId, actor.userId], range.from, range.to, bookingId);
      return { items: freeSlots(windows.filter((row) => row.kind === "AVAILABLE"), [...windows.filter((row) => row.kind === "BLOCKED"), ...occupied], range.from, range.to, durationMinutes), redacted: true, timezone: "Africa/Casablanca" };
    });
  }

  async createBooking(leadId: string, input: BookingInput, principal: Principal, correlationId: string): Promise<BookingView> {
    assertUuid(leadId); strictInput(input, ["responsibilityId", "startsAt", "durationMinutes", "type", "mode", "participantIds", "idempotencyKey"]); assertUuid(input.responsibilityId); assertKey(input.idempotencyKey); assertDuration(input.durationMinutes);
    if (!(appointmentTypes as readonly string[]).includes(input.type) || !(appointmentModes as readonly string[]).includes(input.mode)) invalidAdmissions();
    const start = instant(input.startsAt); const participants = this.participants(input.participantIds);
    return this.transaction(principal, false, async (tx, actor) => {
      const campus = await this.authorizeLead(tx, actor, leadId);
      const profile = await this.activeProfile(tx, input.responsibilityId, campus.code);
      return this.mutation(tx, actor, "BOOKING_CREATE", { leadId, ...input, participantIds: participants, startsAt: start.toISOString() }, async (key) => {
        await this.assertParticipants(tx, participants, campus.keys);
        await lockAppointmentParticipants(tx, [profile.userId, actor.userId, ...participants]);
        await this.assertSlot(tx, profile, start, input.durationMinutes);
        await assertAppointmentFree(tx, [profile.userId, actor.userId, ...participants], start, input.durationMinutes);
        const appointment = await tx.appointment.create({ data: { leadId, type: input.type, mode: input.mode, state: "PLANIFIE", startsAt: start, durationMinutes: input.durationMinutes, campus: campus.code, adviserId: profile.userId, organizerId: actor.userId, evaluatorId: ["ENTRETIEN_ADMISSION", "ENTRETIEN_MOTIVATION", "TEST_ADMISSION"].includes(input.type) ? profile.userId : null, participants: { create: participants.map((userId) => ({ userId, role: "PARTICIPANT" })) } } });
        const row = await tx.admissionsBooking.create({ data: { appointmentId: appointment.id, responsibilityId: profile.id, state: "PENDING" }, include: bookingInclude });
        await this.effects(tx, row, actor, "ADMISSIONS_REQUESTED", key, correlationId);
        return this.bookingView(row, actor, campus.keys, false, campus.label);
      });
    });
  }

  async bookings(principal: Principal, leadId?: string, campusInput?: string, cursor?: string, limit = 50): Promise<{ items: BookingView[]; timezone: "Africa/Casablanca"; hasMore: boolean; nextCursor?: string }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalidAdmissions();
    const initialCursor = cursor ? this.decodeCursor(cursor) : undefined;
    return this.transaction(principal, true, async (tx, actor) => {
      if (leadId) await this.authorizeLead(tx, actor, leadId);
      const campuses = (await this.accessibleCampuses(tx, actor, campusInput)).filter((campus) => campus.canUseAgenda);
      if (!campuses.length) return { items: [], timezone: "Africa/Casablanca", hasMore: false };
      const audience: Prisma.AdmissionsBookingWhereInput[] = campuses.map((campus) => ({ responsibility: { campus: campus.code }, ...(!campus.canManage ? { OR: [
        { appointment: { organizerId: actor.userId } },
        { responsibility: { userId: actor.userId, active: true, user: { active: true, firstLoginRequired: false, campusId: { in: campus.keys }, roles: { hasSome: ["ADMISSIONS", "MANAGER", "ADMIN"] } } } },
      ] } : {}) }));
      const items: BookingView[] = [];
      let seek = initialCursor;
      let hasMore = false;
      // Scan only a bounded authorized audience, with final resource-grant rechecks.
      // If many requester Leads have since become unreadable, return an honest cursor
      // rather than silently declaring the remaining agenda empty/exhaustive.
      for (let scanned = 0; scanned < 1000 && items.length < limit; ) {
        const rows = await tx.admissionsBooking.findMany({ where: { AND: [
          { OR: audience }, ...(leadId ? [{ appointment: { leadId } }] : []),
          ...(seek ? [{ OR: [{ appointment: { startsAt: { gt: seek.startsAt } } }, { appointment: { startsAt: seek.startsAt }, appointmentId: { gt: seek.id } }] }] : []),
        ] }, include: bookingInclude, orderBy: [{ appointment: { startsAt: "asc" } }, { appointmentId: "asc" }], take: 100 });
        if (!rows.length) { hasMore = false; break; }
        hasMore = rows.length === 100;
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!; scanned++; seek = { startsAt: row.appointment.startsAt, id: row.appointmentId };
          const campus = campuses.find((item) => item.code === row.responsibility.campus);
          if (campus && await this.canReadBooking(tx, row, actor, campus.keys)) items.push(this.bookingView(row, actor, campus.keys, campus.canManage, campus.label));
          if (items.length === limit) { hasMore ||= index < rows.length - 1; break; }
        }
        if (!hasMore) break;
      }
      return { items, timezone: "Africa/Casablanca", hasMore, ...(hasMore && seek ? { nextCursor: this.encodeCursor(seek) } : {}) };
    });
  }

  async booking(id: string, principal: Principal): Promise<BookingView> {
    assertUuid(id);
    return this.transaction(principal, true, async (tx, actor) => {
      const row = await tx.admissionsBooking.findUnique({ where: { appointmentId: id }, include: bookingInclude }); if (!row) this.notFound();
      const campus = await this.campus(tx, row.responsibility.campus);
      if (!await this.canReadBooking(tx, row, actor, campus.keys)) this.denied();
      return this.bookingView(row, actor, campus.keys, await this.can(tx, actor, "settings.campus.manage", campus.keys), campus.label);
    });
  }

  async bookingSlots(id: string, from: string, to: string, principal: Principal): ReturnType<AdmissionsService["slots"]> {
    const row = await this.booking(id, principal);
    return this.slots(row.leadId, row.responsibilityId, from, to, row.durationMinutes, principal, id);
  }

  async report(id: string, input: AdmissionsReportInput, principal: Principal, correlationId: string): Promise<BookingView> {
    assertUuid(id); strictInput(input, ["expectedVersion", "idempotencyKey", "result", "comment", "recommendation", "missingPoints", "nextAction", "followUpAt"]); assertVersion(input.expectedVersion); assertKey(input.idempotencyKey);
    if (!(interviewResults as readonly string[]).includes(input.result) || typeof input.comment !== "string" || !input.comment.trim() || input.comment.length > 2000 || typeof input.recommendation !== "string" || !input.recommendation.trim() || input.recommendation.length > 1000 || input.missingPoints !== undefined && (typeof input.missingPoints !== "string" || input.missingPoints.length > 2000) || input.nextAction !== undefined && (typeof input.nextAction !== "string" || input.nextAction.length > 120)) invalidAdmissions();
    const followUp = input.followUpAt ? instant(input.followUpAt) : undefined;
    return this.transaction(principal, false, async (tx, actor) => {
      const row = await tx.admissionsBooking.findUnique({ where: { appointmentId: id }, include: bookingInclude }); if (!row) this.notFound();
      const campus = await this.campus(tx, row.responsibility.campus); await this.activeProfile(tx, row.responsibilityId, campus.code);
      if (row.responsibility.userId !== actor.userId || row.appointment.organizerId === actor.userId || !await this.can(tx, actor, "appointment.manage", campus.keys)) this.denied();
      return this.mutation(tx, actor, "BOOKING_REPORT", { id, ...input, comment: input.comment.trim(), recommendation: input.recommendation.trim(), ...(followUp ? { followUpAt: followUp.toISOString() } : {}) }, async (key) => {
        await lockAppointmentParticipants(tx, this.involved(row));
        if (row.appointment.state !== "REALISE" || row.appointment.evaluatorId !== actor.userId || row.appointment.version !== input.expectedVersion || row.appointment.interviewReports.length || followUp && followUp <= new Date()) throw new ConflictException({ code: "admissions_report_refused" });
        await tx.interviewReport.create({ data: { appointmentId: id, result: input.result, redactedComment: "[REDACTED]", redactedRecommendation: "[REDACTED]", validatedBy: actor.userId, ...(input.missingPoints?.trim() ? { redactedMissingPoints: "[REDACTED]" } : {}), ...(input.nextAction?.trim() ? { nextAction: input.nextAction.trim() } : {}), ...(followUp ? { followUpAt: followUp } : {}) } });
        await tx.appointment.update({ where: { id, version: input.expectedVersion }, data: { version: { increment: 1 } } });
        const updated = await tx.admissionsBooking.findUniqueOrThrow({ where: { appointmentId: id }, include: bookingInclude });
        await this.effects(tx, updated, actor, "ADMISSIONS_REPORT_VALIDATED", key, correlationId, undefined, undefined, followUp);
        return this.bookingView(updated, actor, campus.keys, false, campus.label);
      });
    });
  }

  async decide(id: string, input: BookingDecisionInput, principal: Principal, correlationId: string): Promise<BookingView> {
    assertUuid(id); strictInput(input, ["action", "reason", "startsAt", "expectedVersion", "idempotencyKey"]); assertKey(input.idempotencyKey); assertVersion(input.expectedVersion);
    if (!["ACCEPT", "REFUSE", "CANCEL", "RESCHEDULE", "COMPLETE", "NO_SHOW"].includes(input.action) || input.reason !== undefined && (typeof input.reason !== "string" || input.reason.trim().length > 120)) invalidAdmissions();
    const reason = input.reason?.trim(); if (["REFUSE", "CANCEL", "RESCHEDULE", "NO_SHOW"].includes(input.action) && !reason) invalidAdmissions();
    const start = input.action === "RESCHEDULE" ? instant(input.startsAt) : undefined;
    if (input.action !== "RESCHEDULE" && input.startsAt !== undefined) invalidAdmissions();
    return this.transaction(principal, false, async (tx, actor) => {
      const initial = await tx.admissionsBooking.findUnique({ where: { appointmentId: id }, include: bookingInclude }); if (!initial) this.notFound();
      const campus = await this.campus(tx, initial.responsibility.campus);
      const ownResponsible = initial.responsibility.userId === actor.userId;
      const admin = await this.can(tx, actor, "settings.campus.manage", campus.keys);
      const requester = initial.appointment.organizerId === actor.userId;
      const inCampus = actor.roles.includes("SUPER_ADMIN") || actor.scopes.some((scope) => scope.kind === "CAMPUS" && campus.keys.includes(scope.id));
      if (!inCampus || !await this.can(tx, actor, "appointment.manage", campus.keys)) this.denied();
      if (input.action !== "CANCEL") await this.activeProfile(tx, initial.responsibilityId, campus.code);
      if (input.action === "CANCEL" && !requester && !admin) await this.activeProfile(tx, initial.responsibilityId, campus.code);
      if (["ACCEPT", "REFUSE", "COMPLETE", "NO_SHOW"].includes(input.action)) {
        if (requester) throw new ForbiddenException({ code: "admissions_self_approval_forbidden" });
        if (!ownResponsible && !admin) this.denied();
      } else if (!ownResponsible && !admin) {
        if (!requester) this.denied();
        await this.authorizeLead(tx, actor, initial.appointment.leadId);
      }
      return this.mutation(tx, actor, `BOOKING_${input.action}`, { id, ...input, ...(reason ? { reason } : {}), ...(start ? { startsAt: start.toISOString() } : {}) }, async (key) => {
        await lockAppointmentParticipants(tx, this.involved(initial));
        const row = await tx.admissionsBooking.findUnique({ where: { appointmentId: id }, include: bookingInclude }); if (!row) this.notFound();
        if (row.appointment.version !== input.expectedVersion) this.versionConflict();
        if (["REFUSED", "CANCELLED"].includes(row.state) || terminal.has(row.appointment.state)) throw new ConflictException({ code: "admissions_transition_refused" });
        if (["ACCEPT", "REFUSE"].includes(input.action) && row.state !== "PENDING") throw new ConflictException({ code: "admissions_transition_refused" });
        if (["COMPLETE", "NO_SHOW"].includes(input.action) && (row.state !== "ACCEPTED" || row.appointment.startsAt.valueOf() + row.appointment.durationMinutes * 60_000 > Date.now())) throw new ConflictException({ code: "admissions_transition_refused" });
        const nextStart = start ?? row.appointment.startsAt;
        if (["ACCEPT", "RESCHEDULE"].includes(input.action)) {
          await this.assertSlot(tx, row.responsibility, nextStart, row.appointment.durationMinutes);
          await assertAppointmentFree(tx, this.involved(row), nextStart, row.appointment.durationMinutes, id);
        }
        const state = input.action === "ACCEPT" ? "ACCEPTED" : input.action === "REFUSE" ? "REFUSED" : input.action === "CANCEL" ? "CANCELLED" : input.action === "RESCHEDULE" ? "PENDING" : row.state;
        const appointmentState = input.action === "ACCEPT" ? "CONFIRME" : input.action === "REFUSE" ? "REFUSE" : input.action === "CANCEL" ? "ANNULE" : input.action === "RESCHEDULE" ? "REPORTE" : input.action === "COMPLETE" ? "REALISE" : "ABSENT";
        await tx.appointment.update({ where: { id, version: input.expectedVersion }, data: { startsAt: nextStart, state: appointmentState, version: { increment: 1 } } });
        const updated = await tx.admissionsBooking.update({ where: { appointmentId: id }, data: { state }, include: bookingInclude });
        await this.effects(tx, updated, actor, `ADMISSIONS_${input.action}`, key, correlationId, reason, row.appointment.startsAt);
        return this.bookingView(updated, actor, campus.keys, admin, campus.label);
      });
    });
  }

  private async campus(tx: Tx, value: string): Promise<Campus> {
    if (typeof value !== "string" || !value.trim()) invalidAdmissions();
    let cache = this.campusCache.get(tx); if (!cache) { cache = new Map(); this.campusCache.set(tx, cache); }
    let result = cache.get(value);
    if (!result) { result = (async (): Promise<Campus> => { const canonical = await canonicalCampus(tx, value); const row = await tx.crmReference.findUniqueOrThrow({ where: { id: canonical.id } }); return { id: row.id, code: row.code, label: row.label, keys: canonical.keys }; })(); cache.set(value, result); }
    return result;
  }
  private async accessibleCampuses(tx: Tx, actor: Principal, requested?: string): Promise<AccessibleCampus[]> {
    const keys = actor.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    const rows = await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE",
      ...(!actor.roles.includes("SUPER_ADMIN") ? { OR: [{ id: { in: keys.filter((value) => /^[a-f\d-]{36}$/iu.test(value)) } }, { code: { in: keys } }, { label: { in: keys } }, { keys: { some: { key: { in: keys } } } }] } : {}),
      ...(requested ? { AND: [{ OR: [...(/^[a-f\d-]{36}$/iu.test(requested) ? [{ id: requested }] : []), { code: requested }, { label: requested }, { keys: { some: { key: requested } } }] }] } : {}),
    }, include: { keys: true }, orderBy: { label: "asc" } });
    const result: AccessibleCampus[] = [];
    for (const row of rows) {
      const campus: Campus = { id: row.id, code: row.code, label: row.label, keys: [row.id, row.code, row.label, ...row.keys.map((key) => key.key)] };
      if (requested && !campus.keys.includes(requested)) continue;
      let cache = this.campusCache.get(tx); if (!cache) { cache = new Map(); this.campusCache.set(tx, cache); } for (const key of campus.keys) cache.set(key, Promise.resolve(campus));
      result.push({ ...campus, canManage: await this.can(tx, actor, "settings.campus.manage", campus.keys), canUseAgenda: await this.can(tx, actor, "appointment.manage", campus.keys) });
    }
    return result;
  }
  private snapshots(tx: Tx): ReturnType<DynamicPermissionRepository["snapshots"]> { let snapshots = this.snapshotCache.get(tx); if (!snapshots) { snapshots = this.permissions.snapshots(tx); this.snapshotCache.set(tx, snapshots); } return snapshots; }
  private encodeCursor(value: BookingCursor): string { return Buffer.from(JSON.stringify({ startsAt: value.startsAt.toISOString(), id: value.id })).toString("base64url"); }
  private decodeCursor(value: string): BookingCursor { if (typeof value !== "string" || value.length > 256 || !/^[\w-]+$/u.test(value)) invalidAdmissions(); let parsed: unknown; try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { return invalidAdmissions(); } strictInput(parsed, ["startsAt", "id"]); const row = parsed as { startsAt: string; id: string }; assertUuid(row.id); return { startsAt: instant(row.startsAt), id: row.id }; }
  private async authorizeCampus(tx: Tx, actor: Principal, value?: string): Promise<{ code: string; label: string; keys: string[] }> {
    const raw = value ?? actor.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : [])[0];
    if (!raw) invalidAdmissions(); const campus = await this.campus(tx, raw);
    if (!await this.can(tx, actor, "appointment.manage", campus.keys) && !await this.can(tx, actor, "settings.campus.manage", campus.keys)) this.denied();
    return campus;
  }
  private async authorizeLead(tx: Tx, actor: Principal, id: string): Promise<{ code: string; label: string; keys: string[] }> {
    assertUuid(id); const resource = await leadResource(tx, id); const context = await resourceEvaluationContext(tx, actor, resource); const snapshots = await this.snapshots(tx);
    if (!evaluatePermission(actor, "lead.view", snapshots, context).allowed || !evaluatePermission(actor, "appointment.manage", snapshots, context).allowed) this.denied();
    const row = await tx.lead.findUniqueOrThrow({ where: { id }, select: { campus: true } }); return this.campus(tx, row.campus);
  }
  private async can(tx: Tx, actor: Principal, permission: string, campusKeys: string[]): Promise<boolean> {
    const context = await resourceEvaluationContext(tx, actor, { scope: "CAMPUS", campusKeys, active: true });
    return evaluatePermission(actor, permission, await this.snapshots(tx), context).allowed;
  }
  private profileActive(profile: Profile): boolean { return profile.active && profile.user.active && !profile.user.firstLoginRequired && profile.user.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN"].includes(role)); }
  private async activeProfile(tx: Tx, id: string, campus?: string): Promise<Profile> {
    const row = await tx.admissionsResponsibility.findUnique({ where: { id }, include: { user: true } });
    if (!row || !this.profileActive(row) || campus && row.campus !== campus) throw new ForbiddenException({ code: "admissions_profile_inactive" });
    const canonical = await this.campus(tx, row.campus);
    if (!row.user.campusId || !canonical.keys.includes(row.user.campusId)) this.denied(); return row;
  }
  private async ownOrAdminProfile(tx: Tx, id: string, actor: Principal): Promise<Profile> {
    const row = await this.activeProfile(tx, id); const campus = await this.campus(tx, row.campus);
    if (!await this.can(tx, actor, "appointment.manage", campus.keys) || row.userId !== actor.userId && !await this.can(tx, actor, "settings.campus.manage", campus.keys)) this.denied(); return row;
  }
  private profileView(profile: Profile, campusLabel = profile.campus): ResponsibilityView { return { id: profile.id, userId: profile.userId, label: profile.user.professionalDisplayName?.trim() || "Responsable Admissions", campus: profile.campus, campusLabel, active: profile.active, version: profile.version }; }
  private participants(raw?: string[]): string[] { if (raw !== undefined && (!Array.isArray(raw) || raw.length > 20)) invalidAdmissions(); for (const id of raw ?? []) assertUuid(id); return [...new Set(raw ?? [])].sort((a, b) => a.localeCompare(b, "en")); }
  private async assertParticipants(tx: Tx, ids: string[], campusKeys: string[]): Promise<void> { for (const id of ids) { const row = await tx.collaborator.findUnique({ where: { id } }); if (!row?.active || row.firstLoginRequired || !row.campusId || !campusKeys.includes(row.campusId) || row.roles.every((role) => role === "AUDITOR")) this.denied(); } }
  private involved(row: BookingRow): string[] { return [row.appointment.adviserId, row.appointment.organizerId, ...row.appointment.participants.map((item) => item.userId), ...(row.appointment.evaluatorId ? [row.appointment.evaluatorId] : [])]; }
  private async occupations(tx: Tx, ids: string[], from: Date, to: Date, excludeId?: string): Promise<Array<{ startsAt: Date; endsAt: Date }>> { const rows = await appointmentOccupations(tx, ids, from, to, excludeId); const blocks = await tx.admissionsWindow.findMany({ where: { kind: "BLOCKED", active: true, startsAt: { lt: to }, endsAt: { gt: from }, responsibility: { active: true, userId: { in: ids } } }, select: { startsAt: true, endsAt: true } }); return [...rows, ...blocks]; }
  private async assertSlot(tx: Tx, profile: AdmissionsResponsibility, start: Date, duration: number): Promise<void> { if (start <= new Date()) invalidAdmissions(); const end = new Date(start.valueOf() + duration * 60_000); const windows = await tx.admissionsWindow.findMany({ where: { responsibilityId: profile.id, active: true, startsAt: { lt: end }, endsAt: { gt: start } } }); if (!windows.some((row) => row.kind === "AVAILABLE" && row.startsAt <= start && row.endsAt >= end) || windows.some((row) => row.kind === "BLOCKED")) throw new ConflictException({ code: "admissions_booking_conflict" }); }
  private async canReadBooking(tx: Tx, row: BookingRow, actor: Principal, campusKeys: string[]): Promise<boolean> { const inCampus = actor.roles.includes("SUPER_ADMIN") || actor.scopes.some((scope) => scope.kind === "CAMPUS" && campusKeys.includes(scope.id)); if (!inCampus || !await this.can(tx, actor, "appointment.manage", campusKeys)) return false; if (row.responsibility.userId === actor.userId && this.profileActive(row.responsibility) && row.responsibility.user.campusId && campusKeys.includes(row.responsibility.user.campusId)) return true; if (await this.can(tx, actor, "settings.campus.manage", campusKeys)) return true; if (row.appointment.organizerId !== actor.userId) return false; const context = await resourceEvaluationContext(tx, actor, await leadResource(tx, row.appointment.leadId)); return evaluatePermission(actor, "lead.view", await this.snapshots(tx), context).allowed; }
  private bookingView(row: BookingRow, actor: Principal, campusKeys: readonly string[], admin = false, campusLabel = row.responsibility.campus): BookingView {
    const appointment = row.appointment; const owns = row.responsibility.userId === actor.userId; const requester = appointment.organizerId === actor.userId;
    const designated = this.profileActive(row.responsibility) && Boolean(row.responsibility.user.campusId && campusKeys.includes(row.responsibility.user.campusId));
    const active = designated && !terminal.has(appointment.state);
    const endsAt = new Date(appointment.startsAt.valueOf() + appointment.durationMinutes * 60_000);
    const canOutcome = active && (owns || admin) && !requester && row.state === "ACCEPTED" && endsAt <= new Date();
    return { id: appointment.id, leadId: appointment.leadId, leadIdentifier: appointment.lead.leadCode, leadLabel: `${appointment.lead.firstName} ${appointment.lead.lastName}`.trim(), responsibilityId: row.responsibilityId, responsibleId: row.responsibility.userId, responsibleLabel: row.responsibility.user.professionalDisplayName?.trim() || "Responsable Admissions", requesterId: appointment.organizerId, campus: row.responsibility.campus, campusLabel, type: appointment.type, mode: appointment.mode, state: row.state as BookingView["state"], appointmentState: appointment.state, startsAt: appointment.startsAt.toISOString(), endsAt: endsAt.toISOString(), durationMinutes: appointment.durationMinutes, version: appointment.version,
      canDecide: active && (owns || admin) && !requester && row.state === "PENDING", canCancel: !terminal.has(appointment.state) && (owns && active || requester || admin), canReschedule: active && (owns || requester || admin), canComplete: canOutcome, canNoShow: canOutcome,
      canWriteReport: designated && owns && !requester && appointment.state === "REALISE" && appointment.evaluatorId === actor.userId && !appointment.interviewReports.length,
      ...(appointment.interviewReports[0] ? { reportResult: appointment.interviewReports[0].result } : {}) };
  }
  private async mutation<T, M extends { idempotencyKey: string }>(tx: Tx, actor: Principal, operation: string, input: M, action: (effectKey: string) => Promise<T>): Promise<T> { const { idempotencyKey, ...payload } = input; const fingerprint = hashAdmissions(payload); const existing = await tx.admissionsMutationReceipt.findUnique({ where: { actorId_operation_key: { actorId: actor.userId, operation, key: idempotencyKey } } }); if (existing) { if (existing.fingerprint !== fingerprint) throw new ConflictException({ code: "admissions_idempotency_conflict" }); return existing.response as T; } const effectKey = `admissions-${hashAdmissions([actor.userId, operation, idempotencyKey])}`; const response = await action(effectKey); await tx.admissionsMutationReceipt.create({ data: { actorId: actor.userId, operation, key: idempotencyKey, fingerprint, response: response as Prisma.InputJsonValue } }); return response; }
  private async audit(tx: Tx, actor: Principal, eventType: string, resourceId: string, campus: string, key: string, correlationId: string, after: Prisma.InputJsonObject): Promise<void> { await tx.auditEvent.create({ data: { eventType, resourceType: "APPOINTMENT", resourceId, campusId: campus, actorId: actor.userId, actorRoles: actor.roles, sessionId: actor.sessionId, correlationId, after, result: "SUCCESS", idempotencyKey: `${key}-audit` } }); }
  private async effects(tx: Tx, row: BookingRow, actor: Principal, eventType: string, key: string, correlationId: string, reason?: string, oldStart?: Date, explicitNextAction?: Date): Promise<void> {
    const appointment = row.appointment; const now = new Date(); const isTerminal = terminal.has(appointment.state);
    await tx.appointmentEvent.create({ data: { appointmentId: row.appointmentId, idempotencyKey: key, eventType, toState: appointment.state, actorId: actor.userId, ...(reason ? { reasonCode: reason } : {}) } });
    const nextAction = explicitNextAction ?? (!isTerminal ? appointment.startsAt : undefined);
    await tx.leadActivity.create({ data: { leadId: appointment.leadId, type: "MEETING", result: eventType, authorId: actor.userId, occurredAt: now, correlationId, idempotencyKey: `${key}-activity`, ...(nextAction ? { nextActionAt: nextAction } : {}) } });
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: appointment.leadId }, select: { nextActionAt: true } });
    await tx.lead.update({ where: { id: appointment.leadId }, data: { lastActivityAt: now, version: { increment: 1 }, ...(nextAction ? { nextActionAt: nextAction } : lead.nextActionAt && [appointment.startsAt.valueOf(), oldStart?.valueOf()].includes(lead.nextActionAt.valueOf()) ? { nextActionAt: null } : {}) } });
    await this.audit(tx, actor, eventType, appointment.id, row.responsibility.campus, key, correlationId, { appointmentId: appointment.id, leadId: appointment.leadId, requestState: row.state, appointmentState: appointment.state, startsAt: appointment.startsAt.toISOString(), version: appointment.version });
    for (const recipientId of new Set([row.responsibility.userId, appointment.organizerId])) { const data = { recipientId, type: "APPOINTMENT", priority: "NORMAL", resourceType: "APPOINTMENT", resourceId: appointment.id, href: `/appointments/admissions/${appointment.id}` }; await tx.internalNotification.create({ data: { ...data, deduplicationKey: `${key}-${recipientId}`, fingerprint: hashAdmissions(data) } }); }
  }
  private denied(): never { throw new ForbiddenException({ code: "permission_denied" }); }
  private versionConflict(): never { throw new ConflictException({ code: "admissions_version_conflict" }); }
  private notFound(): never { throw new NotFoundException({ code: "admissions_not_found" }); }
}
