import type { Request } from "express";

export const roles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] as const;
export type Role = (typeof roles)[number];
export type Scope = { kind: "GLOBAL" } | { kind: "CAMPUS" | "TEAM"; id: string };

export interface Principal {
  userId: string;
  roles: Role[];
  scopes: Scope[];
  sessionId: string;
  mustChangeSecret?: boolean | undefined;
}

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

export function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}
