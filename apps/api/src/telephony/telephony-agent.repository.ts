import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";

const terminalStates = new Set(["ENDED", "FAILED", "MISSED", "CANCELLED"]);
const connectionStates = new Set(["CONNECTED", "UNAVAILABLE", "ERROR", "OFFLINE"]);
const allowedTransports = new Set(["UDP", "TCP", "TLS"]);

export interface AgentIdentity {
  workstationId: string;
  userId: string;
  campusId?: string;
  roles: string[];
  profileId: string;
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
  constructor(private readonly prisma: PrismaService) {}
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
    const current = await client.telephonyServerProfile.findUnique({ where: { id: input.id } });
    if (!current) throw new NotFoundException({ code: "telephony_server_profile_not_found" });
    this.assertCampus(principal, current.campusId);
    if (input.expectedVersion !== current.version) throw new ConflictException({ code: "telephony_server_profile_version_conflict", currentVersion: current.version });
    const changed = await client.telephonyServerProfile.updateMany({ where: { id: current.id, version: current.version }, data: { name, sipDomain, proxyUri, transport, campusId, enabled: Boolean(input.enabled), version: { increment: 1 }, updatedBy: principal.userId, updatedAt: now } });
    if (changed.count !== 1) throw new ConflictException({ code: "telephony_server_profile_version_conflict" });
    const row = await client.telephonyServerProfile.findUniqueOrThrow({ where: { id: current.id } });
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
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
    if (input.expectedVersion !== current.version) throw new ConflictException({ code: "telephony_user_profile_version_conflict", currentVersion: current.version });
    const changed = await client.telephonyUserProfile.updateMany({ where: { id: current.id, version: current.version }, data: { serverProfileId, sipAddress, authUsername, enabled, state: enabled ? "PAIRING_REQUIRED" : "DISABLED", version: { increment: 1 }, updatedBy: principal.userId, updatedAt: now } });
    if (changed.count !== 1) throw new ConflictException({ code: "telephony_user_profile_version_conflict" });
    return this.publicUserProfile(await client.telephonyUserProfile.findUniqueOrThrow({ where: { id: current.id } }));
  }

  async createPairingCode(profileId: string, principal: Principal): Promise<{ code: string; expiresAt: string; profileId: string }> {
    this.assertAdmin(principal);
    const client = this.requiredClient();
    const profile = await client.telephonyUserProfile.findUnique({ where: { id: this.uuid(profileId, "telephony_profile_id_invalid") }, include: { user: { select: { campusId: true, active: true } }, workstations: { where: { active: true }, select: { id: true } } } });
    if (!profile) throw new NotFoundException({ code: "telephony_user_profile_not_found" });
    this.assertCampus(principal, profile.user.campusId);
    if (!profile.enabled || !profile.user.active) throw new ConflictException({ code: "telephony_user_profile_inactive" });
    if (profile.workstations.length) throw new ConflictException({ code: "telephony_workstation_already_paired" });
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await client.$transaction(async (tx) => {
      await tx.telephonyPairingCode.updateMany({ where: { userProfileId: profile.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
      await tx.telephonyPairingCode.create({ data: { id: randomUUID(), userProfileId: profile.id, codeDigest: this.digest(code), expiresAt, createdBy: principal.userId } });
    });
    return { code, expiresAt: expiresAt.toISOString(), profileId: profile.id };
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
      const pairing = await tx.telephonyPairingCode.findUnique({ where: { codeDigest: this.digest(code) }, include: { userProfile: { include: { user: true, serverProfile: true, workstations: { where: { active: true } } } } } });
      if (!pairing || pairing.usedAt || pairing.expiresAt <= new Date()) throw new UnauthorizedException({ code: "telephony_pairing_code_refused" });
      const profile = pairing.userProfile;
      if (!profile.enabled || !profile.user.active || !profile.serverProfile.enabled) throw new ForbiddenException({ code: "telephony_pairing_profile_inactive" });
      if (profile.workstations.length) throw new ConflictException({ code: "telephony_workstation_already_paired" });
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
      await tx.telephonyPairingCode.update({ where: { id: pairing.id }, data: { usedAt: new Date() } });
      await tx.telephonyUserProfile.update({ where: { id: profile.id }, data: { state: "LOCAL_CONFIGURATION_REQUIRED", version: { increment: 1 } } });
      return { token: rawToken, workstationId: workstation.id, profile: this.agentProfile(profile, workstation.id) };
    });
  }

  async authenticate(rawToken: string | undefined): Promise<AgentIdentity> {
    if (!rawToken || rawToken.length < 32) throw new UnauthorizedException({ code: "telephony_agent_authentication_refused" });
    const client = this.requiredClient();
    const workstation = await client.telephonyWorkstation.findUnique({ where: { tokenDigest: this.digest(rawToken) }, include: { userProfile: { include: { user: true, serverProfile: true } } } });
    if (!workstation || !workstation.active || !workstation.userProfile.enabled || !workstation.userProfile.user.active || !workstation.userProfile.serverProfile.enabled) throw new UnauthorizedException({ code: "telephony_agent_authentication_refused" });
    return { workstationId: workstation.id, userId: workstation.userProfile.userId, ...(workstation.userProfile.user.campusId ? { campusId: workstation.userProfile.user.campusId } : {}), roles: workstation.userProfile.user.roles, profileId: workstation.userProfile.id };
  }

  async status(identity: AgentIdentity, input: { connectionState?: string; sdkLoaded?: boolean; sipRegistered?: boolean; inputDeviceId?: string | null; outputDeviceId?: string | null; errorCode?: string | null }): Promise<Record<string, unknown>> {
    const connectionState = (input.connectionState ?? "OFFLINE").toUpperCase();
    if (!connectionStates.has(connectionState)) throw new BadRequestException({ code: "telephony_agent_state_invalid" });
    const cleanDevice = (value: string | null | undefined): string | null => value?.trim().slice(0, 255) || null;
    const errorCode = input.errorCode?.trim() || null;
    if (errorCode && !/^[A-Z][A-Z0-9_]{2,79}$/u.test(errorCode)) throw new BadRequestException({ code: "telephony_agent_error_code_invalid" });
    const client = this.requiredClient();
    const current = await client.telephonyWorkstation.findUniqueOrThrow({ where: { id: identity.workstationId } });
    const sdkLoaded = Boolean(input.sdkLoaded); const sipRegistered = Boolean(input.sipRegistered);
    const inputDeviceId = cleanDevice(input.inputDeviceId); const outputDeviceId = cleanDevice(input.outputDeviceId);
    const observableChanged = current.connectionState !== connectionState || current.sdkLoaded !== sdkLoaded
      || current.sipRegistered !== sipRegistered || current.inputDeviceId !== inputDeviceId
      || current.outputDeviceId !== outputDeviceId || current.lastErrorCode !== errorCode;
    const workstation = await client.telephonyWorkstation.update({ where: { id: identity.workstationId }, data: { connectionState, sdkLoaded, sipRegistered, inputDeviceId, outputDeviceId, lastErrorCode: errorCode, lastSeenAt: new Date(), ...(observableChanged ? { version: { increment: 1 } } : {}) } });
    const nextProfileState = workstation.sdkLoaded && workstation.sipRegistered ? "READY" : "LOCAL_CONFIGURATION_REQUIRED";
    await client.telephonyUserProfile.updateMany({ where: { id: identity.profileId, state: { not: nextProfileState } }, data: { state: nextProfileState, version: { increment: 1 } } });
    return this.publicWorkstation(workstation);
  }

  async poll(identity: AgentIdentity): Promise<{ profile: Record<string, unknown>; command: AgentCommandEnvelope | null }> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const now = new Date();
      await tx.telephonyWorkstation.update({ where: { id: identity.workstationId }, data: { lastSeenAt: now } });
      await tx.telephonyAgentCommand.updateMany({ where: { workstationId: identity.workstationId, state: "PENDING", expiresAt: { lte: now } }, data: { state: "EXPIRED", terminalAt: now } });
      const workstation = await tx.telephonyWorkstation.findUniqueOrThrow({ where: { id: identity.workstationId }, include: { userProfile: { include: { serverProfile: true } } } });
      const hangup = await tx.telephonyAgentCommand.findFirst({ where: { workstationId: identity.workstationId, state: "DELIVERED", hangupRequestedAt: { not: null }, hangupDeliveredAt: null }, include: { call: true }, orderBy: { hangupRequestedAt: "asc" } });
      if (hangup) {
        await tx.telephonyAgentCommand.update({ where: { id: hangup.id }, data: { hangupDeliveredAt: now } });
        return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: { commandId: hangup.call.externalId, callId: hangup.callId, destination: "", expiresAt: hangup.expiresAt.toISOString(), maxDurationSeconds: 0, hangupRequested: true } };
      }
      const pending = await tx.telephonyAgentCommand.findFirst({ where: { workstationId: identity.workstationId, state: "PENDING", expiresAt: { gt: now } }, include: { call: true }, orderBy: { createdAt: "asc" } });
      if (!pending) return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: null };
      const claimed = await tx.telephonyAgentCommand.updateMany({ where: { id: pending.id, state: "PENDING" }, data: { state: "DELIVERED", claimedAt: now } });
      if (claimed.count !== 1) return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: null };
      return { profile: this.agentProfile(workstation.userProfile, workstation.id), command: { commandId: pending.call.externalId, callId: pending.callId, destination: this.decrypt(pending.destinationCiphertext, pending.destinationIv, pending.destinationTag), expiresAt: pending.expiresAt.toISOString(), maxDurationSeconds: 7200, hangupRequested: false } };
    });
  }

  async readiness(userId: string): Promise<{ available: boolean; reason?: string; workstationId?: string; identityLabel?: string }> {
    const client = this.requiredClient();
    const profile = await client.telephonyUserProfile.findUnique({ where: { userId }, include: { user: true, serverProfile: true, workstations: { where: { active: true }, orderBy: { pairedAt: "desc" }, take: 1 } } });
    if (!profile || !profile.enabled) return { available: false, reason: "USER_PROFILE_DISABLED" };
    if (!profile.user.active) return { available: false, reason: "USER_DISABLED" };
    if (!profile.serverProfile.enabled) return { available: false, reason: "SERVER_PROFILE_DISABLED" };
    const workstation = profile.workstations[0];
    if (!workstation) return { available: false, reason: "WORKSTATION_NOT_PAIRED" };
    if (!workstation.lastSeenAt || workstation.lastSeenAt < new Date(Date.now() - 30_000)) return { available: false, reason: "WORKSTATION_OFFLINE" };
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
    const client = this.requiredClient();
    const command = await client.telephonyAgentCommand.findFirst({ where: { callId, workstationId: identity.workstationId }, include: { call: true } });
    if (!command || command.call.externalId !== commandId) throw new NotFoundException({ code: "telephony_agent_command_not_found" });
  }

  async markEventApplied(identity: AgentIdentity, callId: string, state: string): Promise<void> {
    if (!terminalStates.has(state)) return;
    const client = this.requiredClient();
    await client.telephonyAgentCommand.updateMany({
      where: { callId, workstationId: identity.workstationId, terminalAt: null },
      data: { state: "TERMINAL", terminalAt: new Date() },
    });
  }

  async revokeWorkstation(workstationId: string, principal: Principal): Promise<Record<string, unknown>> {
    this.assertAdmin(principal);
    const client = this.requiredClient();
    const workstation = await client.telephonyWorkstation.findUnique({ where: { id: this.uuid(workstationId, "telephony_workstation_id_invalid") }, include: { userProfile: { include: { user: { select: { campusId: true } } } } } });
    if (!workstation) throw new NotFoundException({ code: "telephony_workstation_not_found" });
    this.assertCampus(principal, workstation.userProfile.user.campusId);
    const revoked = await client.telephonyWorkstation.update({ where: { id: workstation.id }, data: { active: false, connectionState: "OFFLINE", sipRegistered: false, revokedAt: new Date(), version: { increment: 1 } } });
    await client.telephonyUserProfile.update({ where: { id: workstation.userProfileId }, data: { state: "PAIRING_REQUIRED", version: { increment: 1 } } });
    return this.publicWorkstation(revoked);
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
  private agentProfile(profile: { id: string; sipAddress: string; authUsername: string | null; serverProfile: { sipDomain: string; proxyUri: string | null; transport: string } }, workstationId: string): Record<string, unknown> { return { id: profile.id, workstationId, sipAddress: profile.sipAddress, authUsername: profile.authUsername, server: { sipDomain: profile.serverProfile.sipDomain, proxyUri: profile.serverProfile.proxyUri, transport: profile.serverProfile.transport }, inboundEnabled: false, recordingEnabled: false }; }
}
