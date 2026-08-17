import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Role } from "../auth/auth.types.js";
import { isRole } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";

export interface Collaborator { id: string; professionalEmail: string; secondaryEmail?: string | undefined; roles: Role[]; campusId?: string | undefined; teamId?: string | undefined; active: boolean }
export interface CreateCollaborator { professionalEmail: string; secondaryEmail?: string; roles: string[]; campusId?: string; teamId?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTIFIER = /^[a-zA-Z0-9_-]{2,64}$/;

@Injectable()
export class UserService {
  private readonly users = new Map<string, Collaborator>();
  constructor(private readonly sessions: SessionService, private readonly audit: AuditService) {}

  create(input: CreateCollaborator, actorId: string, correlationId: string): Collaborator {
    const email = input.professionalEmail.trim().toLowerCase();
    if (!EMAIL.test(email) || (input.secondaryEmail && !EMAIL.test(input.secondaryEmail)) || input.roles.length === 0 || !input.roles.every(isRole)) throw new ForbiddenException({ code: "collaborator_invalid" });
    if ([input.campusId, input.teamId].some((value) => value && !IDENTIFIER.test(value))) throw new ForbiddenException({ code: "scope_invalid" });
    if ([...this.users.values()].some((user) => user.professionalEmail === email)) throw new ConflictException({ code: "professional_email_exists" });
    const user: Collaborator = { id: randomUUID(), professionalEmail: email, secondaryEmail: input.secondaryEmail?.toLowerCase(), roles: input.roles, campusId: input.campusId, teamId: input.teamId, active: true };
    this.users.set(user.id, user);
    this.audit.record({ eventType: "COLLABORATOR_CREATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, after: { subjectId: user.id, roles: user.roles, campusId: user.campusId, teamId: user.teamId }, result: "SUCCESS", idempotencyKey: `collaborator-created:${user.id}` });
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
    const revokedSessions = active ? 0 : this.sessions.revokeUser(id);
    this.audit.record({ eventType: active ? "COLLABORATOR_ACTIVATED" : "COLLABORATOR_DEACTIVATED", actorId, actorRoles: ["SUPER_ADMIN"], correlationId, before, after: { subjectId: id, active, revokedSessions }, result: "SUCCESS", idempotencyKey: `collaborator-active:${id}:${active}:${correlationId}` });
    return { ...user, roles: [...user.roles] };
  }
}
