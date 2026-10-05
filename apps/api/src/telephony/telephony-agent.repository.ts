import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { Prisma } from "@prisma/client";
import { isRole } from "../auth/auth.types.js";
import { acquirePermissionFence } from "../permissions/permission-fence.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { ownTelephonyContext, leadResource } from "../permissions/dynamic-resources.js";
import { resourceEvaluationContext } from "../permissions/dynamic-context.js";

const terminalStates = new Set(["ENDED", "FAILED", "MISSED", "CANCELLED"]);
const observedStates = new Set(["DIALING", "RINGING", "ANSWERED", ...terminalStates]);
const connectionStates = new Set(["CONNECTED", "UNAVAILABLE", "ERROR", "OFFLINE"]);
const allowedTransports = new Set(["UDP", "TCP", "TLS"]);

export interface AgentIdentity {
  workstationId: string;
  userId: string;
  campusId?: string;
  roles: string[];
  profileId: string;
  /** Server-only credential generation; never part of a browser DTO. */
  tokenDigest: string;
  authenticationVersion: number;
}

export interface AgentCommandEnvelope {
  commandId: string;
  callId: string;
  destination: string;
  expiresAt: string;
  maxDurationSeconds: number;
  hangupRequested: boolean;
}

@Injectable()
export class TelephonyAgentRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  get enabled(): boolean { return Boolean(this.prisma.client); }

  async listProvisioning(principal: Principal): Promise<Record<string, unknown>> {
    this.assertAdmin(principal);
    const client = this.requiredClient();
    const campusIds = this.campusIds(principal);
    const [servers, users] = await Promise.all([
      client.telephonyServerProfile.findMany({
        where: principal.roles.includes("SUPER_ADMIN") ? {} : { OR: [{ campusId: null }, { campusId: { in: campusIds } }] },
        orderBy: [{ campusId: "asc" }, { name: "asc" }],
      }),
      client.telephonyUserProfile.findMany({
        where: principal.roles.includes("SUPER_ADMIN") ? {} : { user: { campusId: { in: campusIds } } },
        include: { user: { select: { id: true, professionalDisplayName: true, professionalEmail: true, campusId: true, active: true } }, serverProfile: true, workstations: { orderBy: { pairedAt: "desc" } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      servers: servers.map((server) => ({ ...server, createdAt: server.createdAt.toISOString(), updatedAt: server.updatedAt.toISOString() })),
      users: users.map((profile) => ({
        id: profile.id, userId: profile.userId, sipAddress: profile.sipAddress, authUsername: profile.authUsername,
        enabled: profile.enabled, state: profile.state, version: profile.version, user: profile.user,
        server: { id: profile.serverProfile.id, name: profile.serverProfile.name, sipDomain: profile.serverProfile.sipDomain, proxyUri: profile.serverProfile.proxyUri, transport: profile.serverProfile.transport, enabled: profile.serverProfile.enabled },
        workstations: profile.workstations.map((workstation) => this.publicWorkstation(workstation)),
      })),
    };
  }

  async upsertServerProfile(input: { id?: string; name?: string; sipDomain?: string; proxyUri?: string | null; transport?: string; campusId?: string | null; enabled?: boolean; expectedVersion?: number }, principal: Principal): Promise<Record<string, unknown>> {
    this.assertAdmin(principal);
    const name = this.text(input.name, "telephony_server_name_invalid", 2, 120);
    const sipDomain = this.host(input.sipDomain);
    const transport = (input.transport ?? "TLS").toUpperCase();
    if (!allowedTransports.has(transport)) throw new BadRequestException({ code: "telephony_transport_invalid" });
    const campusId = input.campusId?.trim() || null;
    if (!principal.roles.includes("SUPER_ADMIN")) {
      if (!campusId || !this.campusIds(principal).includes(campusId)) throw new ForbiddenException({ code: "telephony_server_scope_forbidden" });
    }
    const proxyUri = input.proxyUri?.trim() || null;
    if (proxyUri && !/^sips?:[^\s@]+(?::\d{1,5})?(?:;transport=(?:udp|tcp|tls))?$/iu.test(proxyUri)) throw new BadRequestException({ code: "telephony_proxy_uri_invalid" });
    const client = this.requiredClient();
    const now = new Date();
    if (!input.id) {
      const row = await client.telephonyServerProfile.create({ data: { id: randomUUID(), name, sipDomain, proxyUri, transport, campusId, enabled: Boolean(input.enabled), createdBy: principal.userId, updatedBy: principal.userId, updatedAt: now } });
      return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }
    const serverId = this.uuid(input.id, "telephony_server_profile_id_invalid");
    return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM telephony_server_profiles WHERE id = ${serverId}::uuid FOR UPDATE`;
    const current = await tx.telephonyServerProfile.findUnique({ where: { id: serverId } });
    if (!current) throw new NotFoundException({ code: "telephony_server_profile_not_found" });
    this.assertCampus(principal, current.campusId);
    if (input.expectedVersion !== current.version) throw new ConflictException({ code: "telephony_server_profile_version_conflict", currentVersion: current.version });
    if (current.sipDomain !== sipDomain || current.proxyUri !== proxyUri || current.transport !== transport || current.campusId !== campusId) {
      const paired = await tx.telephonyWorkstation.count({ where: { active: true, userProfile: { serverProfileId: current.id } } });
      if (paired) throw new ConflictException({ code: "telephony_server_requires_repairing" });
    }
    const changed = await tx.telephonyServerProfile.updateMany({ where: { id: current.id, version: current.version }, data: { name, sipDomain, proxyUri, transport, campusId, enabled: Boolean(input.enabled), version: { increment: 1 }, updatedBy: principal.userId, updatedAt: now } });
    if (changed.count !== 1) throw new ConflictException({ code: "telephony_server_profile_version_conflict" });
    const row = await tx.telephonyServerProfile.findUniqueOrThrow({ where: { id: current.id } });
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    });
  }

  async upsertUserProfile(input: { userId?: string; serverProfileId?: string; sipAddress?: string; authUsername?: string | null; enabled?: boolean; expectedVersion?: number }, principal: Principal): Promise<Record<string, unknown>> {
    this.assertAdmin(principal);
    const userId = this.uuid(input.userId, "telephony_user_id_invalid");
    const serverProfileId = this.uuid(input.serverProfileId, "telephony_server_profile_id_invalid");
    const sipAddress = this.sipAddress(input.sipAddress);
    const authUsername = input.authUsername?.trim() || null;
    if (authUsername && (authUsername.length > 255 || /[\r\n\0]/u.test(authUsername))) throw new BadRequestException({ code: "telephony_auth_username_invalid" });
    const client = this.requiredClient();
    const [user, server, current] = await Promise.all([
      client.collaborator.findUnique({ where: { id: userId }, select: { id: true, campusId: true, active: true } }),
      client.telephonyServerProfile.findUnique({ where: { id: serverProfileId } }),
      client.telephonyUserProfile.findUnique({ where: { userId } }),
    ]);
    if (!user) throw new NotFoundException({ code: "telephony_user_not_found" });
    if (!server) throw new NotFoundException({ code: "telephony_server_profile_not_found" });
    this.assertCampus(principal, user.campusId);
    if (server.campusId && server.campusId !== user.campusId) throw new ForbiddenException({ code: "telephony_server_scope_forbidden" });
    const enabled = Boolean(input.enabled);
    if (enabled && (!user.active || !server.enabled)) throw new ConflictException({ code: "telephony_profile_dependency_inactive" });
    const now = new Date();
    if (!current) {
      const row = await client.telephonyUserProfile.create({ data: { id: randomUUID(), userId, serverProfileId, sipAddress, authUsername, enabled, state: enabled ? "PAIRING_REQUIRED" : "INCOMPLETE", version: 1, updatedBy: principal.userId, updatedAt: now } });
      return this.publicUserProfile(row);
    }
    return client.$transaction(async (tx) => {
    await this.lockProfile(tx, current.id);
    const locked = await tx.telephonyUserProfile.findUniqueOrThrow({ where: { id: current.id }, include: { workstations: { where: { active: true }, select: { id: true } } } });
    if (input.expectedVersion !== locked.version) throw new ConflictException({ code: "telephony_user_profile_version_conflict", currentVersion: locked.version });
    if (locked.workstations.length && (locked.sipAddress !== sipAddress || locked.authUsername !== authUsername || locked.serverProfileId !== serverProfileId)) throw new ConflictException({ code: "telephony_profile_requires_repairing" });
    const changed = await tx.telephonyUserProfile.updateMany({ where: { id: locked.id, version: locked.version }, data: { serverProfileId, sipAddress, authUsername, enabled, state: enabled ? "PAIRING_REQUIRED" : "DISABLED", version: { increment: 1 }, updatedBy: principal.userId, updatedAt: now } });
    if (changed.count !== 1) throw new ConflictException({ code: "telephony_user_profile_version_conflict" });
    return this.publicUserProfile(await tx.telephonyUserProfile.findUniqueOrThrow({ where: { id: current.id } }));
    });
  }

  async createPairingCode(profileId: string, principal: Principal): Promise<{ code: string; expiresAt: string; profileId: string }> {
    this.assertAdmin(principal);
    return this.issuePairingCode(profileId, principal, undefined, "telephony-admin-pairing");
  }

  /** Caller self-service authorization is fenced by TelephonyOwnService; admin retains its separate guard. */
  async issuePairingCode(profileId: string, principal: Principal, expectedVersion: number | undefined, correlationId: string): Promise<{ code: string; expiresAt: string; profileId: string; version: number }> {
    const id = this.uuid(profileId, "telephony_profile_id_invalid");
    const code = randomBytes(24).toString("base64url");
    return this.requiredClient().$transaction(async (tx) => {
      await this.lockProfile(tx, id);
      const profile = await tx.telephonyUserProfile.findUnique({ where: { id }, include: { user: true, serverProfile: true, workstations: { where: { active: true } } } });
      if (!profile) throw new NotFoundException({ code: "telephony_user_profile_not_found" });
      if (profile.userId !== principal.userId) this.assertAdmin(principal);
      this.assertCampus(principal, profile.user.campusId);
      if (!this.profileEligible(profile)) throw new ConflictException({ code: "telephony_user_profile_inactive" });
      if (expectedVersion !== undefined && expectedVersion !== profile.version) throw new ConflictException({ code: "telephony_user_profile_version_conflict" });
      if (profile.workstations.length) throw new ConflictException({ code: "telephony_workstation_already_paired" });
      await this.assertNoActiveCall(tx, profile.userId, profile.id);
      const now = new Date(); const expiresAt = new Date(now.getTime() + 10 * 60_000);
      await tx.telephonyPairingCode.updateMany({ where: { userProfileId: id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      const row = await tx.telephonyPairingCode.create({ data: { id: randomUUID(), userProfileId: id, codeDigest: this.digest(code), expiresAt, createdBy: principal.userId } });
      const updated = await tx.telephonyUserProfile.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit(tx, principal, { campusId: profile.user.campusId, eventType: "TELEPHONY_PAIRING_ISSUED", resourceId: id, idempotencyKey: `telephony-pairing:${row.id}`, correlationId, after: { profileId: id, expiresAt: expiresAt.toISOString(), version: updated.version } });
      return { code, expiresAt: expiresAt.toISOString(), profileId: id, version: updated.version };
    });
  }

  async pair(input: { code?: string; publicId?: string; displayName?: string; agentVersion?: string; sdkVersion?: string }): Promise<Record<string, unknown>> {
    const code = this.text(input.code, "telephony_pairing_code_invalid", 24, 64);
    const publicId = this.identifier(input.publicId, "telephony_workstation_public_id_invalid", 8, 80);
    const displayName = this.text(input.displayName, "telephony_workstation_name_invalid", 2, 120);
    const agentVersion = this.version(input.agentVersion, "telephony_agent_version_invalid");
    const sdkVersion = this.version(input.sdkVersion, "telephony_sdk_version_invalid");
    const client = this.requiredClient();
    const rawToken = randomBytes(48).toString("base64url");
    return client.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "write");
      const candidate = await tx.telephonyPairingCode.findUnique({ where: { codeDigest: this.digest(code) }, select: { userProfileId: true } });
      if (!candidate) throw new UnauthorizedException({ code: "telephony_pairing_code_refused" });
      await this.lockProfile(tx, candidate.userProfileId);
      // Re-read only AFTER the common profile lock: concurrent code consumption,
      // issuance and revocation cannot produce two active workstations.
      const pairing = await tx.telephonyPairingCode.findUnique({ where: { codeDigest: this.digest(code) }, include: { userProfile: { include: { user: true, serverProfile: true, workstations: { where: { active: true } } } } } });
      if (!pairing || pairing.usedAt || pairing.expiresAt <= new Date()) throw new UnauthorizedException({ code: "telephony_pairing_code_refused" });
      const profile = pairing.userProfile;
      if (!this.profileEligible(profile)) throw new ForbiddenException({ code: "telephony_pairing_profile_inactive" });
      const actor = this.machinePrincipal({ userId: profile.userId, roles: profile.user.roles, campusId: profile.user.campusId ?? undefined, workstationId: "pair" });
      if (!evaluatePermission(actor, "interaction.create", await new DynamicPermissionRepository(this.prisma).snapshots(tx), await ownTelephonyContext(tx, actor)).allowed) throw new ForbiddenException({ code: "telephony_pairing_permission_refused" });
      if (profile.workstations.length) throw new ConflictException({ code: "telephony_workstation_already_paired" });
      await this.assertNoActiveCall(tx, profile.userId, profile.id);
      const now = new Date();
      const consumed = await tx.telephonyPairingCode.updateMany({ where: { id: pairing.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (consumed.count !== 1) throw new UnauthorizedException({ code: "telephony_pairing_code_refused" });
      const previous = await tx.telephonyWorkstation.findUnique({ where: { publicId } });
      if (previous?.active) throw new ConflictException({ code: "telephony_workstation_already_paired" });
      if (previous && previous.userProfileId !== profile.id) throw new ConflictException({ code: "telephony_workstation_identity_conflict" });
      const workstation = previous
        ? await tx.telephonyWorkstation.update({ where: { id: previous.id }, data: {
            displayName, tokenDigest: this.digest(rawToken), active: true, connectionState: "OFFLINE", sipRegistered: false, sdkLoaded: false,
            agentVersion, sdkVersion, inputDeviceId: null, outputDeviceId: null, lastErrorCode: null, lastSeenAt: null,
            pairedAt: new Date(), revokedAt: null, version: { increment: 1 },
          } })
        : await tx.telephonyWorkstation.create({ data: { id: randomUUID(), userProfileId: profile.id, publicId, displayName, tokenDigest: this.digest(rawToken), agentVersion, sdkVersion } });
      await tx.telephonyPairingCode.updateMany({ where: { userProfileId: profile.id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      await tx.telephonyUserProfile.update({ where: { id: profile.id }, data: { state: "LOCAL_CONFIGURATION_REQUIRED", version: { increment: 1 } } });
      await this.audit(tx, { userId: profile.userId, roles: profile.user.roles.filter(isRole), scopes: [], sessionId: "" }, { campusId: profile.user.campusId, eventType: "TELEPHONY_WORKSTATION_PAIRED", resourceId: workstation.id, idempotencyKey: `telephony-paired:${pairing.id}`, correlationId: "telephony-agent-pair", after: { profileId: profile.id, workstationId: workstation.id, version: workstation.version } });
      return { token: rawToken, workstationId: workstation.id, profile: this.agentProfile(profile, workstation.id) };
    });
  }

  async authenticate(rawToken: string | undefined): Promise<AgentIdentity> {
    if (!rawToken || rawToken.length < 32) throw new UnauthorizedException({ code: "telephony_agent_authentication_refused" });
    const client = this.requiredClient();
    const workstation = await client.telephonyWorkstation.findUnique({ where: { tokenDigest: this.digest(rawToken) }, include: { userProfile: { include: { user: true, serverProfile: true } } } });
    if (!workstation?.active || !this.profileEligible(workstation.userProfile)) throw new UnauthorizedException({ code: "telephony_agent_authentication_refused" });
    return { workstationId: workstation.id, userId: workstation.userProfile.userId, ...(workstation.userProfile.user.campusId ? { campusId: workstation.userProfile.user.campusId } : {}), roles: workstation.userProfile.user.roles, profileId: workstation.userProfile.id, tokenDigest: workstation.tokenDigest, authenticationVersion: workstation.userProfile.user.authenticationVersion };
  }

  /** Callers hold the permission fence first, then this profile lock, in that order. */
  async revalidate(identity: AgentIdentity): Promise<void> {
    await this.requiredClient().$transaction((tx) => this.lockedIdentity(tx, identity));
  }

  async status(identity: AgentIdentity, input: { connectionState?: string; sdkLoaded?: boolean; sipRegistered?: boolean; inputDeviceId?: string | null; outputDeviceId?: string | null; errorCode?: string | null }): Promise<Record<string, unknown>> {
    const connectionState = (input.connectionState ?? "OFFLINE").toUpperCase();
    if (!connectionStates.has(connectionState)) throw new BadRequestException({ code: "telephony_agent_state_invalid" });
    const cleanDevice = (value: string | null | undefined): string | null => value?.trim().slice(0, 255) || null;
    const errorCode = input.errorCode?.trim() || null;
    if (errorCode && !/^[A-Z][A-Z0-9_]{2,79}$/u.test(errorCode)) throw new BadRequestException({ code: "telephony_agent_error_code_invalid" });
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
    await acquirePermissionFence(tx, "read-audited");
    await this.lockedIdentity(tx, identity);
    const current = await tx.telephonyWorkstation.findUniqueOrThrow({ where: { id: identity.workstationId } });
    const sdkLoaded = Boolean(input.sdkLoaded); const sipRegistered = Boolean(input.sipRegistered);
    const inputDeviceId = cleanDevice(input.inputDeviceId); const outputDeviceId = cleanDevice(input.outputDeviceId);
    const observableChanged = current.connectionState !== connectionState || current.sdkLoaded !== sdkLoaded
      || current.sipRegistered !== sipRegistered || current.inputDeviceId !== inputDeviceId
      || current.outputDeviceId !== outputDeviceId || current.lastErrorCode !== errorCode;
    const workstation = await tx.telephonyWorkstation.update({ where: { id: identity.workstationId }, data: { connectionState, sdkLoaded, sipRegistered, inputDeviceId, outputDeviceId, lastErrorCode: errorCode, lastSeenAt: new Date(), ...(observableChanged ? { version: { increment: 1 } } : {}) } });
    const nextProfileState = workstation.sdkLoaded && workstation.sipRegistered ? "READY" : "LOCAL_CONFIGURATION_REQUIRED";
    await tx.telephonyUserProfile.updateMany({ where: { id: identity.profileId, state: { not: nextProfileState } }, data: { state: nextProfileState, version: { increment: 1 } } });
    return this.publicWorkstation(workstation);
    });
  }

  async poll(identity: AgentIdentity): Promise<{ profile: Record<string, unknown>; command: AgentCommandEnvelope | null }> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "read-audited");
      await this.lockedIdentity(tx, identity);
      const now = new Date();
      await tx.telephonyWorkstation.update({ where: { id: identity.workstationId }, data: { lastSeenAt: now } });
      const staleCommands = await tx.telephonyAgentCommand.findMany({
        where: { workstationId: identity.workstationId, state: { in: ["PENDING", "DELIVERED"] }, terminalAt: null, expiresAt: { lte: now } },
        select: { id: true, callId: true, state: true },
      });
      for (const stale of staleCommands) {
        const uncertainDelivery = stale.state === "DELIVERED";
        await tx.telephonyAgentCommand.update({
          where: { id: stale.id },
          data: { state: uncertainDelivery ? "UNCERTAIN" : "EXPIRED", terminalAt: now },
        });
        await tx.telephonyCall.updateMany({
          where: { id: stale.callId, dispatchState: { in: ["PENDING", "ACCEPTED"] } },
          data: {
            dispatchState: "UNCERTAIN",
            dispatchErrorCode: uncertainDelivery ? "AGENT_RESULT_UNKNOWN" : "AGENT_COMMAND_EXPIRED",
            dispatchUpdatedAt: now,
          },
        });
      }
      const workstation = await tx.telephonyWorkstation.findUniqueOrThrow({ where: { id: identity.workstationId }, include: { userProfile: { include: { serverProfile: true } } } });
      const hangup = await tx.telephonyAgentCommand.findFirst({ where: { workstationId: identity.workstationId, state: "DELIVERED", hangupRequestedAt: { not: null }, hangupDeliveredAt: null }, include: { call: true }, orderBy: { hangupRequestedAt: "asc" } });
      if (hangup) {
        await tx.telephonyAgentCommand.update({ where: { id: hangup.id }, data: { hangupDeliveredAt: now } });
        return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: { commandId: hangup.call.externalId, callId: hangup.callId, destination: "", expiresAt: hangup.expiresAt.toISOString(), maxDurationSeconds: 0, hangupRequested: true } };
      }
      const pending = await tx.telephonyAgentCommand.findFirst({ where: { workstationId: identity.workstationId, state: "PENDING", expiresAt: { gt: now } }, include: { call: true }, orderBy: { createdAt: "asc" } });
      if (!pending) return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: null };
      await this.assertCommandPermission(tx, identity, pending.call);
      const claimed = await tx.telephonyAgentCommand.updateMany({ where: { id: pending.id, state: "PENDING" }, data: { state: "DELIVERED", claimedAt: now } });
      if (claimed.count !== 1) return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: null };
      return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: { commandId: pending.call.externalId, callId: pending.callId, destination: this.decrypt(pending.destinationCiphertext, pending.destinationIv, pending.destinationTag), expiresAt: pending.expiresAt.toISOString(), maxDurationSeconds: 7200, hangupRequested: false } };
    });
  }

  /**
   * Claim the opaque command referenced by the Windows protocol handler.
   * The destination is still read from the encrypted server-side command; it
   * is never accepted from the URI. A command already delivered to this same
   * workstation is returned idempotently so polling and protocol activation
   * can race without creating a second dial attempt.
   */
  async claim(identity: AgentIdentity, commandId: string): Promise<{ profile: Record<string, unknown>; command: AgentCommandEnvelope }> {
    const externalId = this.uuid(commandId, "telephony_agent_command_id_invalid");
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      await acquirePermissionFence(tx, "read-audited");
      await this.lockedIdentity(tx, identity);
      const now = new Date();
      await tx.telephonyWorkstation.update({ where: { id: identity.workstationId }, data: { lastSeenAt: now } });
      const workstation = await tx.telephonyWorkstation.findUniqueOrThrow({
        where: { id: identity.workstationId },
        include: { userProfile: { include: { serverProfile: true } } },
      });
      const command = await tx.telephonyAgentCommand.findFirst({
        where: {
          workstationId: identity.workstationId,
          terminalAt: null,
          state: { in: ["PENDING", "DELIVERED"] },
          call: { externalId },
        },
        include: { call: true },
      });
      if (!command) throw new NotFoundException({ code: "telephony_agent_command_not_found" });
      await this.assertCommandPermission(tx, identity, command.call);
      if (command.expiresAt <= now) {
        const uncertainDelivery = command.state === "DELIVERED";
        await tx.telephonyAgentCommand.update({ where: { id: command.id }, data: { state: uncertainDelivery ? "UNCERTAIN" : "EXPIRED", terminalAt: now } });
        await tx.telephonyCall.updateMany({ where: { id: command.callId, dispatchState: { in: ["PENDING", "ACCEPTED"] } }, data: {
          dispatchState: "UNCERTAIN", dispatchErrorCode: uncertainDelivery ? "AGENT_RESULT_UNKNOWN" : "AGENT_COMMAND_EXPIRED", dispatchUpdatedAt: now,
        } });
        throw new ConflictException({ code: "telephony_agent_command_expired" });
      }
      if (command.state === "PENDING") {
        const claimed = await tx.telephonyAgentCommand.updateMany({ where: { id: command.id, state: "PENDING" }, data: { state: "DELIVERED", claimedAt: now } });
        if (claimed.count !== 1) throw new ConflictException({ code: "telephony_agent_command_claim_conflict" });
      }
      return {
        profile: this.agentProfile(workstation.userProfile, workstation.id),
        command: {
          commandId: command.call.externalId,
          callId: command.callId,
          destination: this.decrypt(command.destinationCiphertext, command.destinationIv, command.destinationTag),
          expiresAt: command.expiresAt.toISOString(),
          maxDurationSeconds: 7200,
          hangupRequested: false,
        },
      };
    });
  }

  async readiness(userId: string): Promise<{ available: boolean; reason?: string; workstationId?: string; identityLabel?: string }> {
    const client = this.requiredClient();
    const profile = await client.telephonyUserProfile.findUnique({ where: { userId }, include: { user: true, serverProfile: true, workstations: { where: { active: true }, orderBy: { pairedAt: "desc" }, take: 2 } } });
    if (!profile || !profile.enabled) return { available: false, reason: "USER_PROFILE_DISABLED" };
    if (!profile.user.active || profile.user.firstLoginRequired || !profile.user.roles.every(isRole) || !profile.user.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) return { available: false, reason: "USER_DISABLED" };
    if (!profile.serverProfile.enabled) return { available: false, reason: "SERVER_PROFILE_DISABLED" };
    if (profile.serverProfile.campusId && profile.serverProfile.campusId !== profile.user.campusId) return { available: false, reason: "SERVER_PROFILE_SCOPE_MISMATCH" };
    if (profile.workstations.length > 1) return { available: false, reason: "WORKSTATION_AMBIGUOUS" };
    const workstation = profile.workstations[0];
    if (!workstation) return { available: false, reason: "WORKSTATION_NOT_PAIRED" };
    if (!workstation.lastSeenAt || workstation.lastSeenAt < new Date(Date.now() - 30_000) || workstation.connectionState !== "CONNECTED") return { available: false, reason: "WORKSTATION_OFFLINE" };
    if (!workstation.sdkLoaded) return { available: false, reason: "SDK_NOT_LOADED" };
    if (!workstation.sipRegistered) return { available: false, reason: "SIP_NOT_REGISTERED" };
    return { available: true, workstationId: workstation.id, identityLabel: profile.sipAddress };
  }

  async enqueue(callId: string, userId: string, destination: string): Promise<{ accepted: boolean; workstationId: string }> {
    const ready = await this.readiness(userId);
    const workstationId = ready.workstationId;
    if (!ready.available || !workstationId) throw new ServiceUnavailableException({ code: "telephony_agent_not_ready", reason: ready.reason });
    const encrypted = this.encrypt(destination);
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const candidate = await tx.telephonyUserProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!candidate) throw new ServiceUnavailableException({ code: "telephony_agent_not_ready" });
      await this.lockProfile(tx, candidate.id);
      const profile = await tx.telephonyUserProfile.findUniqueOrThrow({ where: { id: candidate.id }, include: { user: true, serverProfile: true, workstations: { where: { active: true }, take: 2 } } });
      const selected = profile.workstations[0];
      if (!this.profileEligible(profile) || profile.workstations.length !== 1 || selected?.id !== workstationId || !selected.lastSeenAt
        || selected.lastSeenAt < new Date(Date.now() - 30_000) || selected.connectionState !== "CONNECTED" || !selected.sdkLoaded || !selected.sipRegistered) throw new ServiceUnavailableException({ code: "telephony_agent_not_ready" });
      const existing = await tx.telephonyAgentCommand.findUnique({ where: { callId } });
      if (existing) return { accepted: true, workstationId: existing.workstationId };
      const busy = await tx.telephonyAgentCommand.findFirst({ where: { workstationId, state: { in: ["PENDING", "DELIVERED"] }, terminalAt: null }, select: { id: true } });
      if (busy) throw new ConflictException({ code: "telephony_workstation_busy" });
      await tx.telephonyAgentCommand.create({ data: { id: randomUUID(), callId, workstationId, destinationCiphertext: encrypted.ciphertext, destinationIv: encrypted.iv, destinationTag: encrypted.tag, expiresAt: new Date(Date.now() + 45_000), updatedAt: new Date() } });
      return { accepted: true, workstationId };
    });
  }

  async requestHangup(callId: string, userId: string): Promise<void> {
    const client = this.requiredClient();
    const command = await client.telephonyAgentCommand.findUnique({ where: { callId }, include: { workstation: { include: { userProfile: true } } } });
    if (!command || command.workstation.userProfile.userId !== userId) throw new NotFoundException({ code: "telephony_agent_command_not_found" });
    if (command.terminalAt) throw new ConflictException({ code: "telephony_call_not_active" });
    await client.telephonyAgentCommand.update({ where: { id: command.id }, data: { hangupRequestedAt: command.hangupRequestedAt ?? new Date() } });
  }

  async assertEvent(identity: AgentIdentity, commandId: string, callId: string, state: string): Promise<void> {
    if (!observedStates.has(state)) throw new BadRequestException({ code: "telephony_agent_event_state_invalid" });
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
    await acquirePermissionFence(tx, "read-audited");
    await this.lockedIdentity(tx, identity);
    const command = await tx.telephonyAgentCommand.findFirst({ where: { callId, workstationId: identity.workstationId }, include: { call: true } });
    if (!command || command.call.externalId !== commandId) throw new NotFoundException({ code: "telephony_agent_command_not_found" });
    });
  }

  async markEventApplied(identity: AgentIdentity, callId: string, state: string): Promise<void> {
    if (!terminalStates.has(state)) return;
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
    await acquirePermissionFence(tx, "read-audited");
    await this.lockedIdentity(tx, identity);
    const current = await tx.telephonyAgentCommand.findFirst({ where: { callId, workstationId: identity.workstationId }, select: { id: true, terminalAt: true } });
    if (!current) return;
    await tx.telephonyAgentCommand.update({ where: { id: current.id }, data: { state: "TERMINAL", terminalAt: current.terminalAt ?? new Date() } });
    });
  }

  async revokeWorkstation(workstationId: string, principal: Principal): Promise<Record<string, unknown>> {
    this.assertAdmin(principal);
    const workstation = await this.requiredClient().telephonyWorkstation.findUnique({ where: { id: this.uuid(workstationId, "telephony_workstation_id_invalid") }, select: { userProfileId: true } });
    if (!workstation) throw new NotFoundException({ code: "telephony_workstation_not_found" });
    return this.revokeOwnWorkstation(workstationId, workstation.userProfileId, undefined, principal, "telephony-admin-revoke");
  }

  async revokeOwnWorkstation(workstationId: string, profileId: string, expectedVersion: number | undefined, principal: Principal, correlationId: string): Promise<Record<string, unknown>> {
    const id = this.uuid(workstationId, "telephony_workstation_id_invalid");
    return this.requiredClient().$transaction(async (tx) => {
      await this.lockProfile(tx, profileId);
      const workstation = await tx.telephonyWorkstation.findFirst({ where: { id, userProfileId: profileId }, include: { userProfile: { include: { user: true } } } });
      if (!workstation) throw new NotFoundException({ code: "telephony_workstation_not_found" });
      if (workstation.userProfile.userId !== principal.userId) this.assertAdmin(principal);
      this.assertCampus(principal, workstation.userProfile.user.campusId);
      // Idempotent retry of the exact successful generation is harmless.
      if (!workstation.active && (expectedVersion === undefined || workstation.version === expectedVersion + 1)) return this.publicWorkstation(workstation);
      if (expectedVersion !== undefined && expectedVersion !== workstation.version) throw new ConflictException({ code: "telephony_workstation_version_conflict" });
      await this.assertNoActiveCall(tx, workstation.userProfile.userId, profileId);
      const now = new Date();
      const revoked = await tx.telephonyWorkstation.update({ where: { id }, data: { active: false, connectionState: "OFFLINE", sdkLoaded: false, sipRegistered: false, revokedAt: now, version: { increment: 1 } } });
      await tx.telephonyPairingCode.updateMany({ where: { userProfileId: profileId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      await tx.telephonyUserProfile.update({ where: { id: profileId }, data: { state: "PAIRING_REQUIRED", version: { increment: 1 } } });
      await this.audit(tx, principal, { campusId: workstation.userProfile.user.campusId, eventType: "TELEPHONY_WORKSTATION_REVOKED", resourceId: id, idempotencyKey: `telephony-revoked:${id}:${workstation.version}`, correlationId, after: { workstationId: id, active: false, version: revoked.version } });
      return this.publicWorkstation(revoked);
    });
  }

  private async lockProfile(tx: Prisma.TransactionClient, profileId: string): Promise<void> {
    const profile = await tx.telephonyUserProfile.findUnique({ where: { id: profileId }, select: { serverProfileId: true } });
    if (profile) {
      // SIP connection edits exclude association while other profiles on the same
      // server may continue in parallel. Fixed order: server, then user profile.
      await tx.$queryRaw`SELECT id FROM telephony_server_profiles WHERE id = ${profile.serverProfileId}::uuid FOR SHARE`;
    }
    await tx.$queryRaw`SELECT id FROM telephony_user_profiles WHERE id = ${profileId}::uuid FOR UPDATE`;
    const locked = await tx.telephonyUserProfile.findUnique({ where: { id: profileId }, select: { serverProfileId: true } });
    if (profile && locked?.serverProfileId !== profile.serverProfileId) throw new ConflictException({ code: "telephony_user_profile_version_conflict" });
  }
  private profileEligible(profile: { enabled: boolean; user: { active: boolean; firstLoginRequired: boolean; roles: string[]; campusId: string | null }; serverProfile: { enabled: boolean; campusId: string | null } }): boolean {
    return profile.enabled && profile.user.active && !profile.user.firstLoginRequired && profile.serverProfile.enabled
      && profile.user.roles.length > 0 && profile.user.roles.every(isRole)
      && profile.user.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))
      && (!profile.serverProfile.campusId || profile.serverProfile.campusId === profile.user.campusId);
  }
  private async assertNoActiveCall(tx: Prisma.TransactionClient, userId: string, profileId: string): Promise<void> {
    const [command, call] = await Promise.all([
      tx.telephonyAgentCommand.findFirst({ where: { workstation: { userProfileId: profileId }, terminalAt: null }, select: { id: true } }),
      // Complementing terminal states also fences unknown future/nonterminal states.
      tx.telephonyCall.findFirst({ where: { createdBy: userId, provider: "LINPHONE", state: { notIn: [...terminalStates] } }, select: { id: true } }),
    ]);
    if (command || call) throw new ConflictException({ code: "telephony_workstation_busy" });
  }
  private async lockedIdentity(tx: Prisma.TransactionClient, identity: AgentIdentity): Promise<void> {
    await this.lockProfile(tx, identity.profileId);
    const workstation = await tx.telephonyWorkstation.findUnique({ where: { id: identity.workstationId }, include: { userProfile: { include: { user: true, serverProfile: true } } } });
    if (!workstation?.active || workstation.userProfileId !== identity.profileId || workstation.userProfile.userId !== identity.userId
      || workstation.tokenDigest !== identity.tokenDigest || workstation.userProfile.user.campusId !== (identity.campusId ?? null)
      || workstation.userProfile.user.authenticationVersion !== identity.authenticationVersion
      || [...workstation.userProfile.user.roles].sort((left, right) => left.localeCompare(right)).join(",") !== [...identity.roles].sort((left, right) => left.localeCompare(right)).join(",")
      || !this.profileEligible(workstation.userProfile)) throw new UnauthorizedException({ code: "telephony_agent_authentication_refused" });
  }
  private machinePrincipal(identity: { userId: string; roles: string[]; campusId?: string | undefined; workstationId: string }): Principal {
    const roles = identity.roles.filter(isRole);
    return { userId: identity.userId, roles, sessionId: `agent-${identity.workstationId}`, scopes: [
      ...(roles.includes("SUPER_ADMIN") ? [{ kind: "GLOBAL" as const }] : []),
      ...(identity.campusId ? [{ kind: "CAMPUS" as const, id: identity.campusId }] : []),
    ] };
  }
  private async assertCommandPermission(tx: Prisma.TransactionClient, identity: AgentIdentity, call: { createdBy: string; leadId: string | null; direction: string; provider: string }): Promise<void> {
    if (call.createdBy !== identity.userId || call.direction !== "OUTBOUND" || call.provider !== "LINPHONE") throw new ForbiddenException({ code: "telephony_agent_command_scope_forbidden" });
    const principal = this.machinePrincipal(identity);
    const context = call.leadId ? await resourceEvaluationContext(tx, principal, await leadResource(tx, call.leadId)) : await ownTelephonyContext(tx, principal);
    const permission = call.leadId ? "interaction.create" : "telephony.free-call.create";
    if (!evaluatePermission(principal, permission, await new DynamicPermissionRepository(this.prisma).snapshots(tx), context).allowed) throw new ForbiddenException({ code: "telephony_agent_command_scope_forbidden" });
  }
  private async audit(tx: Prisma.TransactionClient, principal: Principal, input: { campusId: string | null; eventType: string; resourceId: string; idempotencyKey: string; correlationId: string; after: Prisma.InputJsonValue }): Promise<void> {
    const { campusId, eventType, resourceId, idempotencyKey, correlationId, after } = input;
    await tx.auditEvent.create({ data: { id: randomUUID(), campusId, resourceType: "TELEPHONY_PROFILE", resourceId, eventType,
      actorId: principal.userId, actorRoles: principal.roles, ...( /^[0-9a-f-]{36}$/iu.test(principal.sessionId) ? { sessionId: principal.sessionId } : {}),
      correlationId: correlationId.slice(0, 64), after, result: "SUCCESS", idempotencyKey } });
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new ServiceUnavailableException({ code: "telephony_persistence_required" });
    return this.prisma.client;
  }
  private assertAdmin(principal: Principal): void {
    if (!principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "telephony_administration_forbidden" });
  }
  private assertCampus(principal: Principal, campusId: string | null): void {
    if (principal.roles.includes("SUPER_ADMIN") && principal.scopes.some((scope) => scope.kind === "GLOBAL")) return;
    if (!campusId || !this.campusIds(principal).includes(campusId)) throw new ForbiddenException({ code: "telephony_profile_scope_forbidden" });
  }
  private campusIds(principal: Principal): string[] { return principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []); }
  private digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
  private key(): Buffer {
    const raw = process.env.TELEPHONY_COMMAND_ENCRYPTION_KEY?.trim() ?? "";
    let key: Buffer;
    try { key = Buffer.from(raw, "base64"); } catch { key = Buffer.alloc(0); }
    if (key.length !== 32) throw new ServiceUnavailableException({ code: "telephony_command_encryption_not_configured" });
    return key;
  }
  private encrypt(value: string): { ciphertext: string; iv: string; tag: string } {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }
  private decrypt(ciphertext: string, iv: string, tag: string): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
  private host(value: string | undefined): string { const host = value?.trim() ?? ""; if (!/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/iu.test(host)) throw new BadRequestException({ code: "telephony_sip_domain_invalid" }); return host.toLowerCase(); }
  private sipAddress(value: string | undefined): string { const address = value?.trim() ?? ""; if (!/^sip:[^\s@:]{1,120}@[a-z0-9.-]{1,253}$/iu.test(address)) throw new BadRequestException({ code: "telephony_sip_address_invalid" }); return address; }
  private uuid(value: string | undefined, code: string): string { if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new BadRequestException({ code }); return value; }
  private identifier(value: string | undefined, code: string, min: number, max: number): string { const text = value?.trim() ?? ""; if (text.length < min || text.length > max || !/^[A-Za-z0-9_.-]+$/u.test(text)) throw new BadRequestException({ code }); return text; }
  private text(value: string | undefined, code: string, min: number, max: number): string { const text = value?.trim() ?? ""; if (text.length < min || text.length > max || /[\r\n\0]/u.test(text)) throw new BadRequestException({ code }); return text; }
  private version(value: string | undefined, code: string): string { const text = value?.trim() ?? ""; if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/u.test(text)) throw new BadRequestException({ code }); return text; }
  private publicUserProfile(row: { id: string; userId: string; serverProfileId: string; sipAddress: string; authUsername: string | null; enabled: boolean; state: string; version: number }): Record<string, unknown> { return { id: row.id, userId: row.userId, serverProfileId: row.serverProfileId, sipAddress: row.sipAddress, authUsername: row.authUsername, enabled: row.enabled, state: row.state, version: row.version }; }
  private publicWorkstation(row: { id: string; publicId: string; displayName: string; active: boolean; connectionState: string; sipRegistered: boolean; sdkLoaded: boolean; agentVersion: string; sdkVersion: string; inputDeviceId: string | null; outputDeviceId: string | null; lastErrorCode: string | null; lastSeenAt: Date | null; pairedAt: Date; revokedAt: Date | null; version: number }): Record<string, unknown> { return { id: row.id, publicId: row.publicId, displayName: row.displayName, active: row.active, connectionState: row.connectionState, sipRegistered: row.sipRegistered, sdkLoaded: row.sdkLoaded, agentVersion: row.agentVersion, sdkVersion: row.sdkVersion, inputDeviceId: row.inputDeviceId, outputDeviceId: row.outputDeviceId, lastErrorCode: row.lastErrorCode, lastSeenAt: row.lastSeenAt?.toISOString() ?? null, pairedAt: row.pairedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, version: row.version }; }
  private agentProfile(profile: { id: string; sipAddress: string; authUsername: string | null; user?: { professionalDisplayName?: string | null; professionalEmail?: string | null }; serverProfile: { sipDomain: string; proxyUri: string | null; transport: string } }, workstationId: string): Record<string, unknown> { return { id: profile.id, workstationId, sipAddress: profile.sipAddress, authUsername: profile.authUsername, server: { sipDomain: profile.serverProfile.sipDomain, proxyUri: profile.serverProfile.proxyUri, transport: profile.serverProfile.transport }, inboundEnabled: false, recordingEnabled: false, crmDisplayName: profile.user?.professionalDisplayName ?? null, crmEmail: profile.user?.professionalEmail ?? null }; }
}
