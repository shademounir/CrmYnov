import type { Prisma } from "@prisma/client";
import type { Role } from "../auth/auth.types.js";
import type { ConfigurationTarget, Grants, PermissionDefinition, PermissionScope } from "./dynamic-contract.js";
import type { PermissionDecision } from "./dynamic-evaluator.js";
export interface ConfigurationChange { permission: string; from: PermissionScope; to: PermissionScope; widening: boolean; sensitive: boolean }
export interface CatalogueResponse { campus: string; catalogueVersion: number; catalogue: readonly PermissionDefinition[]; roles: { role: Role; label: string; description: string; users: number; editable: boolean }[]; campuses: { id: string; code: string }[]; global: boolean }
export interface ConfigurationResponse extends ConfigurationTarget { version: number; inherited: boolean; grants: Grants; globalCeiling: Grants }
export interface PreviewResponse { changes: ConfigurationChange[]; affectedUsers: number; expectedVersion: number; mutated: false }
export interface SaveResponse { version: number; changes: ConfigurationChange[]; roles: Role[] }
export interface HistoryVersion { number: number; createdAt: Date; grants: { permission: string; scope: string }[]; audits: { actorId: string; actorRoles: Prisma.JsonValue; reason: string; previous: Prisma.JsonValue; next: Prisma.JsonValue; createdAt: Date }[] }
export interface EffectiveResponse { catalogueVersion: number; roles: Role[]; permissions: PermissionDecision[]; businessRules: string }
