import { ConflictException, ForbiddenException, Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Role } from "../auth/auth.types.js";
import { isRole } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { professionalDisplayName } from "./professional-display-name.js";

export interface Collaborator { id: string; professionalEmail: string; secondaryEmail?: string | undefined; roles: Role[]; campusId?: string | undefined; teamId?: string | undefined; active: boolean; authenticationVersion: number }
export interface CreateCollaborator { professionalEmail: string; secondaryEmail?: string; professionalDisplayName?: string | null; roles: string[]; campusId?: string; teamId?: string }
export interface UpdateAuthorization { roles: string[]; campusId?: string; teamId?: string; reason: string; confirmed: boolean }

const IDENTIFIER = /^[a-zA-Z0-9_-]{2,64}$/;

function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  const dot = value.indexOf(".", at + 2);
  return at > 0 && at === value.lastIndexOf("@") && dot > at + 1 && dot < value.length - 1 && !/\s/.test(value);
}

@Injectable()
export class UserService implements OnModuleInit {
  private readonly users = new Map<string, Collaborator>();
  private pendingWrite: Promise<unknown> = Promise.resolve();
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.prisma?.client?.collaborator.findMany();
    for (const row of rows ?? []) {
      const user: Collaborator = {
        id: row.id,
        professionalEmail: row.professionalEmail,
        secondaryEmail: row.secondaryEmail ?? undefined,
        roles: row.roles as Role[],
        campusId: row.campusId ?? undefined,
        teamId: row.teamId ?? undefined,
        active: row.active,
        authenticationVersion: row.authenticationVersion,
      };
      this.users.set(user.id, user);
      this.sessions.updateIdentityState(user.id, user.active, user.authenticationVersion);
    }
  }

  create(input: CreateCollaborator, actorId: string, correlationId: string): Collaborator {
    const displayName = professionalDisplayName(input.professionalDisplayName);
    const email = input.professionalEmail.trim().toLowerCase();
    if (!isEmail(email) || (input.secondaryEmail && !isEmail(input.secondaryEmail)) || input.roles.length === 0 || !input.roles.every(isRole)) throw new ForbiddenException({ code: "collaborator_invalid" });
    if ([input.campusId, input.teamId].some((value) => value && !IDENTIFIER.test(value))) throw new ForbiddenException({ code: "scope_invalid" });
    if ([...this.users.values()].some((user) => user.professionalEmail === email)) throw new ConflictException({ code: "professional_email_exists" });
    const user: Collaborator = { id: randomUUID(), professionalEmail: email, secondaryEmail: input.secondaryEmail?.toLowerCase(), roles: input.roles, campusId: input.campusId, teamId: input.teamId, active: true, authenticationVersion: 1 };
    this.users.set(user.id, user);
    this.sessions.updateIdentityState(user.id, true, user.authenticationVersion);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.create({ data: { id: user.id, professionalEmail: user.professionalEmail, professionalDisplayName: displayName, secondaryEmail: user.secondaryEmail ?? null, roles: user.roles, campusId: user.campusId ?? null, teamId: user.teamId ?? null, active: true, firstLoginRequired: true, authenticationVersion: 1 } }));
    this.audit.record({ eventType: "COLLABORATOR_CREATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, after: { subjectId: user.id, roles: user.roles, campusId: user.campusId, teamId: user.teamId, displayNameProvided: displayName !== null }, result: "SUCCESS", idempotencyKey: `collaborator-created:${user.id}` });
    return { ...user, roles: [...user.roles] };
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
    this.audit.record({ eventType: active ? "COLLABORATOR_ACTIVATED" : "COLLABORATOR_DEACTIVATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, before, after: { subjectId: id, active, revokedSessions }, result: "SUCCESS", idempotencyKey: `collaborator-active:${id}:${active}:${correlationId}` });
    return { ...user, roles: [...user.roles] };
  }

  updateAuthorization(id: string, input: UpdateAuthorization, actorId: string, correlationId: string): Collaborator {
    const user = this.users.get(id);
    if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
    const reasons = ["RESPONSIBILITY_CHANGE", "TEAM_CHANGE", "CAMPUS_CHANGE", "ACCESS_REVIEW"];
    if (!input.confirmed || !reasons.includes(input.reason) || input.roles.length === 0 || !input.roles.every(isRole)) throw new ForbiddenException({ code: "authorization_change_invalid" });
    if ([input.campusId, input.teamId].some((value) => value && !IDENTIFIER.test(value))) throw new ForbiddenException({ code: "scope_invalid" });
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

  findById(id: string): Collaborator | undefined {
    const user = this.users.get(id);
    return user ? { ...user, roles: [...user.roles] } : undefined;
  }

  findByProfessionalEmail(email: string): Collaborator | undefined {
    const normalized = email.trim().toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.professionalEmail === normalized);
    return user ? { ...user, roles: [...user.roles] } : undefined;
  }

  completeFirstLogin(id: string): void {
    const user = this.users.get(id);
    if (!user) throw new ForbiddenException({ code: "collaborator_not_found" });
    user.authenticationVersion += 1;
    this.sessions.updateIdentityState(id, user.active, user.authenticationVersion);
    const client = this.prisma?.client;
    if (client) this.enqueue(client.collaborator.update({ where: { id }, data: { firstLoginRequired: false, authenticationVersion: user.authenticationVersion } }));
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
    await this.sessions.flush();
  }

  private enqueue(operation: Promise<unknown>): void {
    this.pendingWrite = this.pendingWrite.then(() => operation);
  }
}
