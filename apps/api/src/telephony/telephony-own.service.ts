import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { currentPrincipal, permissionDenied } from "../permissions/dynamic-context.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../permissions/dynamic-repository.js";
import { ownTelephonyContext } from "../permissions/dynamic-resources.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { TelephonyAgentRepository } from "./telephony-agent.repository.js";

export interface OwnTelephonyView {
  global: { enabled: boolean; mode: string };
  profile: { id: string; extension: string; enabled: boolean; state: string; version: number } | null;
  workstation: {
    id: string; displayName: string; active: boolean; connectionState: string; sdkLoaded: boolean; sipRegistered: boolean;
    agentVersion: string; sdkVersion: string; lastSeenAt: string | null; pairedAt: string; revokedAt: string | null; version: number;
    inputConfigured: boolean; outputConfigured: boolean; lastErrorCode: string | null;
  } | null;
  readiness: { available: boolean; reason: string | null };
  canPair: boolean;
  canRevoke: boolean;
  localPreferencesOnly: true;
  inboundEnabled: false;
  recordingEnabled: false;
}

export interface OwnTelephonyHealth {
  globalEnabled: boolean; canCall: boolean; configured: boolean; profileEnabled: boolean; serverScopeValid: boolean; serverEnabled: boolean;
  activeCount: number; workstation?: { lastSeenAt: Date | null; connectionState: string; sdkLoaded: boolean; sipRegistered: boolean } | undefined;
}
/** Readiness is observed, time-bounded and never inferred from a stored READY label. */
export function ownTelephonyReadiness(state: OwnTelephonyHealth, now = Date.now()): OwnTelephonyView["readiness"] {
  const refused = (reason: string): OwnTelephonyView["readiness"] => ({ available: false, reason });
  if (!state.globalEnabled) return refused("MODE_DISABLED");
  if (!state.canCall) return refused("CALL_PERMISSION_REQUIRED");
  if (!state.configured) return refused("USER_PROFILE_NOT_CONFIGURED");
  if (!state.profileEnabled) return refused("USER_PROFILE_DISABLED");
  if (!state.serverScopeValid) return refused("SERVER_PROFILE_SCOPE_MISMATCH");
  if (!state.serverEnabled) return refused("SERVER_PROFILE_DISABLED");
  if (state.activeCount > 1) return refused("WORKSTATION_AMBIGUOUS");
  if (!state.activeCount) return refused("WORKSTATION_NOT_PAIRED");
  const workstation = state.workstation;
  if (!workstation?.lastSeenAt || workstation.lastSeenAt.getTime() < now - 30_000 || workstation.connectionState !== "CONNECTED") return refused("WORKSTATION_OFFLINE");
  if (!workstation.sdkLoaded) return refused("SDK_NOT_LOADED");
  if (!workstation.sipRegistered) return refused("SIP_NOT_REGISTERED");
  return { available: true, reason: null };
}

/** Self-service never provisions a SIP profile, changes a server or broadens grants. */
@Injectable()
export class TelephonyOwnService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DynamicPermissionRepository) private readonly permissions: DynamicPermissionRepository,
    @Inject(TelephonyAgentRepository) private readonly agents: TelephonyAgentRepository,
  ) {}
  read(principal: Principal): Promise<OwnTelephonyView> {
    return this.permissions.readTransaction(async (tx) => this.view(tx, await this.authorize(tx, principal, "interaction.view")));
  }
  pairing(input: { expectedVersion?: number }, principal: Principal, correlationId: string): Promise<{ code: string; expiresAt: string; profileId: string; version: number }> {
    this.versionInput(input);
    return this.permissions.transaction(async (tx) => {
      const actor = await this.authorize(tx, principal, "interaction.create");
      const profile = await tx.telephonyUserProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!profile) throw new ConflictException({ code: "telephony_user_profile_not_configured" });
      return this.agents.issuePairingCode(profile.id, actor, input.expectedVersion, correlationId);
    });
  }
  revoke(workstationId: string, input: { expectedVersion?: number }, principal: Principal, correlationId: string): Promise<OwnTelephonyView> {
    this.versionInput(input);
    return this.permissions.transaction(async (tx) => {
      const actor = await this.authorize(tx, principal, "interaction.create");
      const profile = await tx.telephonyUserProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!profile) throw new NotFoundException({ code: "telephony_workstation_not_found" });
      await this.agents.revokeOwnWorkstation(workstationId, profile.id, input.expectedVersion, actor, correlationId);
      return this.view(tx, actor);
    });
  }
  private async authorize(tx: PermissionTransaction, principal: Principal, permission: string): Promise<Principal> {
    if (!this.prisma.client) throw new ServiceUnavailableException({ code: "telephony_persistence_required" });
    const actor = await currentPrincipal(tx, principal);
    if (!actor.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) permissionDenied();
    if (!evaluatePermission(actor, permission, await this.permissions.snapshots(tx), await ownTelephonyContext(tx, actor)).allowed) permissionDenied();
    return actor;
  }
  private async view(tx: PermissionTransaction, actor: Principal): Promise<OwnTelephonyView> {
    const [configuration, profile] = await Promise.all([
      tx.telephonyConfiguration.findFirst({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { mode: true, outboundEnabled: true, clickToCallEnabled: true } }),
      tx.telephonyUserProfile.findUnique({ where: { userId: actor.userId }, select: {
        id: true, sipAddress: true, enabled: true, state: true, version: true,
        user: { select: { active: true, campusId: true } }, serverProfile: { select: { enabled: true, campusId: true } },
        workstations: { orderBy: [{ active: "desc" }, { pairedAt: "desc" }, { id: "asc" }], take: 2, select: {
          id: true, displayName: true, active: true, connectionState: true, sdkLoaded: true, sipRegistered: true,
          agentVersion: true, sdkVersion: true, lastSeenAt: true, pairedAt: true, revokedAt: true, version: true,
          inputDeviceId: true, outputDeviceId: true, lastErrorCode: true,
        } },
      } }),
    ]);
    const mode = configuration?.mode ?? "DISABLED";
    const globalEnabled = mode === "LINPHONE" && configuration?.outboundEnabled === true && configuration.clickToCallEnabled;
    const active = profile?.workstations.filter((row) => row.active) ?? [];
    let workstation = profile?.workstations[0];
    if (active.length) {
      workstation = active.length === 1 ? active[0] : undefined;
    }
    const serverScopeValid = !profile?.serverProfile.campusId || profile.serverProfile.campusId === profile.user.campusId;
    const writable = evaluatePermission(actor, "interaction.create", await this.permissions.snapshots(tx), await ownTelephonyContext(tx, actor)).allowed;
    const readiness = ownTelephonyReadiness({ globalEnabled: Boolean(globalEnabled), canCall: writable, configured: Boolean(profile),
      profileEnabled: Boolean(profile?.enabled), serverScopeValid, serverEnabled: Boolean(profile?.serverProfile.enabled), activeCount: active.length, workstation });
    return {
      global: { enabled: Boolean(globalEnabled), mode },
      profile: profile ? { id: profile.id, extension: /^sip:([^@]+)@/u.exec(profile.sipAddress)?.[1] ?? "", enabled: profile.enabled, state: profile.state, version: profile.version } : null,
      workstation: workstation ? {
        id: workstation.id, displayName: workstation.displayName, active: workstation.active, connectionState: workstation.connectionState,
        sdkLoaded: workstation.sdkLoaded, sipRegistered: workstation.sipRegistered, agentVersion: workstation.agentVersion, sdkVersion: workstation.sdkVersion,
        lastSeenAt: workstation.lastSeenAt?.toISOString() ?? null, pairedAt: workstation.pairedAt.toISOString(), revokedAt: workstation.revokedAt?.toISOString() ?? null,
        version: workstation.version, inputConfigured: Boolean(workstation.inputDeviceId), outputConfigured: Boolean(workstation.outputDeviceId), lastErrorCode: workstation.lastErrorCode,
      } : null,
      readiness,
      canPair: Boolean(writable && profile?.enabled && profile.serverProfile.enabled && serverScopeValid && !active.length),
      canRevoke: writable && active.length === 1,
      localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
    };
  }
  private versionInput(input: { expectedVersion?: number }): void {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "expectedVersion")
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 1) throw new BadRequestException({ code: "telephony_expected_version_invalid" });
  }
}
