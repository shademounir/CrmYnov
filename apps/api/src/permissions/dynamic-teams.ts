import { ConflictException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import type { PermissionTransaction } from "./dynamic-repository.js";
import { invalidConfiguration } from "./dynamic-contract.js";
import { canonicalCampus } from "./dynamic-resources.js";
import { permissionDenied } from "./dynamic-context.js";

export interface TeamResponsibilityInput { teamId: string; campusId: string; managerId: string; active: boolean; expectedVersion: number; confirmed: boolean }
export interface TeamResponsibilityView { id: string; teamId: string; campusId: string; managerId: string; active: boolean; version: number }
export function validateResponsibility(input: TeamResponsibilityInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidConfiguration();
  const fields = ["teamId", "campusId", "managerId", "active", "expectedVersion", "confirmed"];
  if (Object.keys(input).some((key) => !fields.includes(key))) invalidConfiguration();
  if (![input.teamId, input.managerId, input.campusId].every((value) => typeof value === "string")) invalidConfiguration();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.teamId) || !/^[a-f\d-]{36}$/i.test(input.managerId) || !/^[a-f\d-]{36}$/i.test(input.campusId)) invalidConfiguration();
  if (typeof input.active !== "boolean" || input.confirmed !== true || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) invalidConfiguration();
}
export async function saveResponsibility(tx: PermissionTransaction, actor: Principal, input: TeamResponsibilityInput): Promise<TeamResponsibilityView> {
  const campus = await canonicalCampus(tx, input.campusId);
  const manager = await tx.collaborator.findUnique({ where: { id: input.managerId } });
  if (input.active) {
    if (!manager?.active || !manager.roles.includes("MANAGER") || !manager.campusId || !campus.keys.includes(manager.campusId)) permissionDenied();
    // The caller may designate an existing team, never invent active membership.
    const members = await tx.collaborator.count({ where: { active: true, teamId: input.teamId, campusId: { in: campus.keys } } });
    if (!members) permissionDenied();
  }
  const selector = { teamId_campusId_managerId: { teamId: input.teamId, campusId: campus.id, managerId: input.managerId } };
  const before = await tx.teamResponsibility.findUnique({ where: selector });
  if ((before?.version ?? 0) !== input.expectedVersion) throw new ConflictException({ code: "permission_version_conflict" });
  if (before?.active === input.active) throw new ConflictException({ code: "permission_no_change" });
  const row = before
    ? await tx.teamResponsibility.update({ where: { id: before.id, version: input.expectedVersion }, data: { active: input.active, version: { increment: 1 } } })
    : await tx.teamResponsibility.create({ data: { teamId: input.teamId, campusId: campus.id, managerId: input.managerId, active: input.active } });
  await tx.auditEvent.create({ data: { eventType: "TEAM_RESPONSIBILITY_CHANGED", actorId: actor.userId, actorRoles: [...actor.roles], sessionId: actor.sessionId, correlationId: `team-responsibility:${row.id}`, before: { active: before?.active ?? false, version: before?.version ?? 0 }, after: { teamId: row.teamId, campusId: row.campusId, managerId: row.managerId, active: row.active, version: row.version }, result: "SUCCESS", idempotencyKey: `team-responsibility:${row.id}:${row.version}` } });
  return { id: row.id, teamId: row.teamId, campusId: row.campusId, managerId: row.managerId, active: row.active, version: row.version };
}
