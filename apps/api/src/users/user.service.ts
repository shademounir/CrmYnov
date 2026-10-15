import { ConflictException, ForbiddenException, Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../auth/auth.types.js";
import { isRole } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { digestRecoveryValue, LocalCredentialAdapter } from "../access-recovery/access-recovery.store.js";
import { professionalDisplayName } from "./professional-display-name.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

export interface Collaborator { id: string; professionalEmail: string; secondaryEmail?: string | undefined; roles: Role[]; campusId?: string | undefined; teamId?: string | undefined; active: boolean; authenticationVersion: number; firstLoginRequired?: boolean }
export interface CreateCollaborator { professionalEmail: string; secondaryEmail?: string; professionalDisplayName?: string | null; roles: string[]; campusId?: string; teamId?: string }
export interface UpdateAuthorization { roles: string[]; campusId?: string; teamId?: string; reason: string; confirmed: boolean }
export interface UpdateCollaboratorProfile { professionalDisplayName: string }
export interface IssueTemporarySecret { reason: "INITIAL_ACCESS" | "CREDENTIAL_COMPROMISED" | "USER_REQUEST"; confirmed: boolean }
export interface TemporarySecretResult { temporarySecret: string; mustChangeAtFirstLogin: true; revokedSessions: number }

const IDENTIFIER = /^[a-zA-Z0-9_-]{2,64}$/;

function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  const dot = value.indexOf(".", at + 2);
  return at > 0 && at === value.lastIndexOf("@") && dot > at + 1 && dot < value.length - 1 && !/\s/.test(value);
}

function validateScopes(input: { campusId?: string; teamId?: string }): void {
  if ([input.campusId, input.teamId].some((value) => value && !IDENTIFIER.test(value))) throw new ForbiddenException({ code: "scope_invalid" });
}

function validateCreation(input: CreateCollaborator): { displayName: string | null; email: string } {
  const displayName = professionalDisplayName(input.professionalDisplayName), email = input.professionalEmail.trim().toLowerCase();
  if (!isEmail(email) || (input.secondaryEmail && !isEmail(input.secondaryEmail)) || input.roles.length === 0 || !input.roles.every(isRole)) throw new ForbiddenException({ code: "collaborator_invalid" });
  validateScopes(input);
  return { displayName, email };
}

function validateAuthorization(input: UpdateAuthorization): void {
  if (!input.confirmed || !["RESPONSIBILITY_CHANGE", "TEAM_CHANGE", "CAMPUS_CHANGE", "ACCESS_REVIEW"].includes(input.reason) || !input.roles.length || !input.roles.every(isRole)) throw new ForbiddenException({ code: "authorization_change_invalid" });
  validateScopes(input);
}

@Injectable()
export class UserService implements OnModuleInit {
  private readonly users = new Map<string, Collaborator>();
  private pendingWrite: Promise<unknown> = Promise.resolve();
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() @Inject(LocalCredentialAdapter) private readonly credentials?: LocalCredentialAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    const client = this.prisma?.client;
    if (!client) return;
    const rows = await client.collaborator.findMany();
    this.users.clear();
    for (const row of rows) {
      const user: Collaborator = {
        id: row.id,
        professionalEmail: row.professionalEmail,
        secondaryEmail: row.secondaryEmail ?? undefined,
        roles: row.roles as Role[],
        campusId: row.campusId ?? undefined,
        teamId: row.teamId ?? undefined,
        active: row.active,
        authenticationVersion: row.authenticationVersion,
        firstLoginRequired: row.firstLoginRequired,
      };
      this.users.set(user.id, user);
      this.sessions.updateIdentityState(user.id, user.active, user.authenticationVersion);
    }
  }

  create(input: CreateCollaborator, actorId: string, correlationId: string): Collaborator {
    const { displayName, email } = validateCreation(input);
    if ([...this.users.values()].some((user) => user.professionalEmail === email)) throw new ConflictException({ code: "professional_email_exists" });
    const user: Collaborator = { id: randomUUID(), professionalEmail: email, secondaryEmail: input.secondaryEmail?.toLowerCase(), roles: input.roles as Role[], campusId: input.campusId, teamId: input.teamId, active: true, authenticationVersion: 1, firstLoginRequired: true };
    this.users.set(user.id, user);
    this.sessions.updateIdentityState(user.id, true, user.authenticationVersion);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.create({ data: { id: user.id, professionalEmail: user.professionalEmail, professionalDisplayName: displayName, secondaryEmail: user.secondaryEmail ?? null, roles: user.roles, campusId: user.campusId ?? null, teamId: user.teamId ?? null, active: true, firstLoginRequired: true, authenticationVersion: 1 } }));
    this.audit.record({ eventType: "COLLABORATOR_CREATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, after: { subjectId: user.id, roles: user.roles, campusId: user.campusId, teamId: user.teamId, displayNameProvided: displayName !== null }, result: "SUCCESS", idempotencyKey: `collaborator-created:${user.id}` });
    return { ...user, roles: [...user.roles] };
  }

  /** Governed HTTP creation commits the identity and its audit together. */
  async createForApi(input: CreateCollaborator, actorId: string, correlationId: string): Promise<Collaborator> {
    const client = this.prisma?.client;
    if (!client) { const user = this.create(input, actorId, correlationId); await this.flush(); return user; }
    const { displayName, email } = validateCreation(input);
    return client.$transaction(async (tx) => {
      if (await tx.collaborator.findUnique({ where: { professionalEmail: email } })) throw new ConflictException({ code: "professional_email_exists" });
      const actor = await tx.collaborator.findUnique({ where: { id: actorId } });
      if (!actor?.active || !actor.roles.includes("SUPER_ADMIN")) throw new ForbiddenException({ code: "authorization_change_invalid" });
      const campusId = input.campusId ? (await canonicalCampus(tx, input.campusId)).id : null;
      const row = await tx.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: displayName, secondaryEmail: input.secondaryEmail?.toLowerCase() ?? null, roles: input.roles as Role[], campusId, teamId: input.teamId ?? null, active: true, firstLoginRequired: true, authenticationVersion: 1 } });
      await tx.auditEvent.create({ data: { eventType: "COLLABORATOR_CREATED", actorId, actorRoles: actor.roles, campusId: row.campusId, resourceType: "COLLABORATOR", resourceId: row.id, correlationId, result: "SUCCESS", idempotencyKey: `collaborator-created:${row.id}`, after: { subjectId: row.id, roles: row.roles, campusId: row.campusId, teamId: row.teamId, displayNameProvided: displayName !== null } } });
      return { id: row.id, professionalEmail: row.professionalEmail, secondaryEmail: row.secondaryEmail ?? undefined, roles: row.roles as Role[], campusId: row.campusId ?? undefined, teamId: row.teamId ?? undefined, active: row.active, authenticationVersion: row.authenticationVersion, firstLoginRequired: row.firstLoginRequired };
    }, { isolationLevel: "Serializable" });
  }

  /** No role/version/session change may survive a failed durable audit. */
  async updateAuthorizationForApi(id: string, input: UpdateAuthorization, actorId: string, correlationId: string): Promise<Collaborator> {
    const client = this.prisma?.client;
    if (!client) { const user = this.updateAuthorization(id, input, actorId, correlationId); await this.flush(); return user; }
    validateAuthorization(input);
    return client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM collaborators WHERE id = ${id}::uuid FOR UPDATE`;
      const user = await tx.collaborator.findUnique({ where: { id } }), actor = await tx.collaborator.findUnique({ where: { id: actorId } });
      if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
      if (!actor?.active || !actor.roles.includes("SUPER_ADMIN")) throw new ForbiddenException({ code: "authorization_change_invalid" });
      const roles = [...new Set(input.roles)] as Role[], campusId = input.campusId ? (await canonicalCampus(tx, input.campusId)).id : null, teamId = input.teamId ?? null;
      const currentRoles = new Set(user.roles);
      const unchanged = currentRoles.size === roles.length && roles.every((role) => currentRoles.has(role)) && user.campusId === campusId && user.teamId === teamId;
      if (user.active && user.roles.includes("SUPER_ADMIN") && !roles.includes("SUPER_ADMIN") && await tx.collaborator.count({ where: { active: true, roles: { has: "SUPER_ADMIN" } } }) <= 1) throw new ConflictException({ code: "last_super_admin_required" });
      let row = user;
      if (!unchanged) {
        row = await tx.collaborator.update({ where: { id }, data: { roles, campusId, teamId, authenticationVersion: { increment: 1 } } });
        const revoked = await tx.localSession.updateMany({ where: { collaboratorId: id, active: true }, data: { active: false, revokedAt: new Date() } });
        await tx.auditEvent.create({ data: { eventType: "COLLABORATOR_AUTHORIZATION_CHANGED", actorId, actorRoles: actor.roles, campusId, resourceType: "COLLABORATOR", resourceId: id, correlationId, result: "SUCCESS", idempotencyKey: `collaborator-authorization:${id}:v${user.authenticationVersion}`, before: { roles: user.roles, campusId: user.campusId, teamId: user.teamId }, after: { subjectId: id, roles, campusId, teamId, reason: input.reason, revokedSessions: revoked.count, authenticationVersion: row.authenticationVersion } } });
      }
      return { id: row.id, professionalEmail: row.professionalEmail, secondaryEmail: row.secondaryEmail ?? undefined, roles: row.roles as Role[], campusId: row.campusId ?? undefined, teamId: row.teamId ?? undefined, active: row.active, authenticationVersion: row.authenticationVersion, firstLoginRequired: row.firstLoginRequired };
    }, { isolationLevel: "Serializable" });
  }

  /** Governed write-only profile metadata update. It does not change authorization or browser sessions. */
  async updateProfileForApi(id: string, input: UpdateCollaboratorProfile, actorId: string, correlationId: string): Promise<Collaborator> {
    const displayName = professionalDisplayName(input.professionalDisplayName);
    if (!displayName) throw new ForbiddenException({ code: "professional_display_name_required" });
    const client = this.prisma?.client;
    if (!client) {
      const user = this.users.get(id);
      if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
      this.audit.record({ eventType: "COLLABORATOR_PROFILE_UPDATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, after: { subjectId: id, displayNameConfigured: true }, result: "SUCCESS", idempotencyKey: `collaborator-profile:${id}:${correlationId}` });
      return { ...user, roles: [...user.roles] };
    }
    return client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM collaborators WHERE id = ${id}::uuid FOR UPDATE`;
      const user = await tx.collaborator.findUnique({ where: { id } });
      const actor = await tx.collaborator.findUnique({ where: { id: actorId } });
      if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
      if (!actor?.active || !actor.roles.includes("SUPER_ADMIN")) throw new ForbiddenException({ code: "authorization_change_invalid" });
      const changed = user.professionalDisplayName !== displayName;
      const row = changed ? await tx.collaborator.update({ where: { id }, data: { professionalDisplayName: displayName } }) : user;
      if (changed) await tx.auditEvent.create({ data: { eventType: "COLLABORATOR_PROFILE_UPDATED", actorId, actorRoles: actor.roles, campusId: row.campusId, resourceType: "COLLABORATOR", resourceId: row.id, correlationId, result: "SUCCESS", idempotencyKey: `collaborator-profile:${row.id}:${correlationId}`, before: { displayNameConfigured: user.professionalDisplayName !== null }, after: { subjectId: row.id, displayNameConfigured: true } } });
      return { id: row.id, professionalEmail: row.professionalEmail, secondaryEmail: row.secondaryEmail ?? undefined, roles: row.roles as Role[], campusId: row.campusId ?? undefined, teamId: row.teamId ?? undefined, active: row.active, authenticationVersion: row.authenticationVersion, firstLoginRequired: row.firstLoginRequired };
    }, { isolationLevel: "Serializable" });
  }

  list(filters: { active?: boolean | undefined; campusId?: string | undefined; teamId?: string | undefined } = {}): Collaborator[] {
    return [...this.users.values()].filter((user) => filters.active === undefined || user.active === filters.active).filter((user) => !filters.campusId || user.campusId === filters.campusId).filter((user) => !filters.teamId || user.teamId === filters.teamId).map((user) => ({ ...user, roles: [...user.roles] }));
  }

  setActive(id: string, active: boolean, actorId: string, correlationId: string): Collaborator {
    const user = this.users.get(id);
    if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
    if (!active && user.active && user.roles.includes("SUPER_ADMIN") && this.list({ active: true }).filter((candidate) => candidate.roles.includes("SUPER_ADMIN")).length <= 1) throw new ConflictException({ code: "last_super_admin_required" });
    const before = { active: user.active };
    user.active = active;
    user.authenticationVersion += 1;
    this.sessions.updateIdentityState(id, active, user.authenticationVersion);
    const revokedSessions = active ? 0 : this.sessions.revokeUser(id);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.update({ where: { id }, data: { active, authenticationVersion: user.authenticationVersion } }));
    if (client && !active) this.enqueue(client.localAccessInvitation.updateMany({ where: { collaboratorId: id, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } }));
    this.audit.record({ eventType: active ? "COLLABORATOR_ACTIVATED" : "COLLABORATOR_DEACTIVATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, before, after: { subjectId: id, active, revokedSessions }, result: "SUCCESS", idempotencyKey: `collaborator-active:${id}:${active}:${correlationId}` });
    return { ...user, roles: [...user.roles] };
  }

  updateAuthorization(id: string, input: UpdateAuthorization, actorId: string, correlationId: string): Collaborator {
    const user = this.users.get(id);
    if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
    validateAuthorization(input);
    const removesSuperAdmin = user.roles.includes("SUPER_ADMIN") && !input.roles.includes("SUPER_ADMIN");
    if (user.active && removesSuperAdmin && this.list({ active: true }).filter((candidate) => candidate.roles.includes("SUPER_ADMIN")).length <= 1) throw new ConflictException({ code: "last_super_admin_required" });
    const before = { roles: [...user.roles], campusId: user.campusId, teamId: user.teamId };
    user.roles = [...input.roles] as Role[];
    user.campusId = input.campusId;
    user.teamId = input.teamId;
    user.authenticationVersion += 1;
    this.sessions.updateIdentityState(id, user.active, user.authenticationVersion);
    const revokedSessions = this.sessions.revokeUser(id);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.update({ where: { id }, data: { roles: user.roles, campusId: user.campusId ?? null, teamId: user.teamId ?? null, authenticationVersion: user.authenticationVersion } }));
    this.audit.record({ eventType: "COLLABORATOR_AUTHORIZATION_CHANGED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, before, after: { subjectId: id, roles: user.roles, campusId: user.campusId, teamId: user.teamId, reason: input.reason, revokedSessions }, result: "SUCCESS", idempotencyKey: `collaborator-authorization:${id}:${correlationId}` });
    return { ...user, roles: [...user.roles] };
  }

  issueTemporarySecret(id: string, input: IssueTemporarySecret, actorId: string, correlationId: string): TemporarySecretResult {
    const user = this.users.get(id);
    if (!user?.active) throw new ForbiddenException({ code: "collaborator_not_found_or_inactive" });
    if (!input.confirmed || !["INITIAL_ACCESS", "CREDENTIAL_COMPROMISED", "USER_REQUEST"].includes(input.reason)) throw new ForbiddenException({ code: "temporary_secret_issue_invalid" });
    if (!this.credentials) throw new ForbiddenException({ code: "credential_store_unavailable" });
    const temporarySecret = `CrmYnov-${randomBytes(24).toString("base64url")}!9`;
    this.credentials.provisionTemporary(id, temporarySecret, digestRecoveryValue(user.professionalEmail));
    user.firstLoginRequired = true;
    user.authenticationVersion += 1;
    this.sessions.updateIdentityState(id, true, user.authenticationVersion);
    const revokedSessions = this.sessions.revokeUser(id);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.update({ where: { id }, data: { firstLoginRequired: true, authenticationVersion: user.authenticationVersion } }));
    if (client) this.enqueue(client.localAccessInvitation.updateMany({ where: { collaboratorId: id, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } }));
    this.audit.record({ eventType: "COLLABORATOR_TEMPORARY_SECRET_ISSUED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, after: { subjectId: id, reason: input.reason, revokedSessions, mustChangeAtFirstLogin: true }, result: "SUCCESS", idempotencyKey: `collaborator-temporary-secret:${id}:${correlationId}` });
    return { temporarySecret, mustChangeAtFirstLogin: true, revokedSessions };
  }

  findById(id: string): Collaborator | undefined {
    const user = this.users.get(id);
    return user ? { ...user, roles: [...user.roles] } : undefined;
  }

  async findByIdForApi(id: string): Promise<Collaborator | undefined> {
    const client = this.prisma?.client;
    if (!client) return this.findById(id);
    const row = await client.collaborator.findUnique({ where: { id } });
    if (!row) return undefined;
    const user: Collaborator = { id: row.id, professionalEmail: row.professionalEmail, secondaryEmail: row.secondaryEmail ?? undefined, roles: row.roles as Role[], campusId: row.campusId ?? undefined, teamId: row.teamId ?? undefined, active: row.active, authenticationVersion: row.authenticationVersion, firstLoginRequired: row.firstLoginRequired };
    this.users.set(id, user);
    this.sessions.updateIdentityState(id, user.active, user.authenticationVersion);
    return { ...user, roles: [...user.roles] };
  }

  findByProfessionalEmail(email: string): Collaborator | undefined {
    const normalized = email.trim().toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.professionalEmail === normalized);
    return user ? { ...user, roles: [...user.roles] } : undefined;
  }

  completeFirstLogin(id: string): void {
    const user = this.users.get(id);
    if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
    user.firstLoginRequired = false;
    user.authenticationVersion += 1;
    this.sessions.updateIdentityState(id, user.active, user.authenticationVersion);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.update({ where: { id }, data: { firstLoginRequired: false, authenticationVersion: user.authenticationVersion } }));
    if (client) this.enqueue(client.localAccessInvitation.updateMany({ where: { collaboratorId: id, state: { in: ["PENDING", "SENT", "SEND_UNCONFIRMED"] } }, data: { state: "REVOKED" } }));
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
    await this.credentials?.flush();
    await this.sessions.flush();
  }

  private enqueue(operation: Promise<unknown>): void {
    this.pendingWrite = this.pendingWrite.then(() => operation);
  }
}
