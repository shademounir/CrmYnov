import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { isRole, type AuthenticatedRequest, type Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { TelephonyService, type AssociationCandidate, type CallRecord, type TelephonyBridgeEvent, type TelephonyConfiguration, type TelephonyConfigurationView } from "./telephony.service.js";
import { TelephonyAgentRepository } from "./telephony-agent.repository.js";

@Controller() @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class TelephonyController {
  constructor(@Inject(TelephonyService) private readonly telephony: TelephonyService) {}
  @Get("telephony/configuration") configuration(@Req() request: AuthenticatedRequest): Promise<TelephonyConfigurationView> { return this.telephony.configurationForApi(this.principal(request)); }
  @Patch("telephony/configuration") @RequireRoles("SUPER_ADMIN") configure(@Body() body: Parameters<TelephonyService["configure"]>[0], @Req() request: AuthenticatedRequest): Promise<TelephonyConfiguration> { return this.telephony.configureForApi(body, this.principal(request), this.correlation(request)); }
  @Post("leads/:leadId/calls") initiate(@Param("leadId") leadId: string, @Body() body: { idempotencyKey?: string; followUpComment?: string; nextActionAt?: string }, @Req() request: AuthenticatedRequest): Promise<CallRecord> { return this.telephony.initiateForApi(leadId, body, this.principal(request), this.correlation(request)); }
  @Get("leads/:leadId/calls") listLeadCalls(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): Promise<{ items: CallRecord[] }> { return this.telephony.callsForLeadForApi(leadId, this.principal(request), this.correlation(request)); }
  @Get("calls/:callId") detail(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): Promise<CallRecord> { return this.telephony.callForApi(callId, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/end") end(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): ReturnType<TelephonyService["endForApi"]> { return this.telephony.endForApi(callId, this.principal(request), this.correlation(request)); }
  @Get("calls/:callId/association-candidates") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") associationCandidates(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): Promise<{ items: AssociationCandidate[] }> { return this.telephony.associationCandidatesForApi(callId, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/events") event(@Param("callId") callId: string, @Body() body: { idempotencyKey?: string; state?: string; occurredAt?: string; reasonCode?: string }, @Req() request: AuthenticatedRequest): Promise<CallRecord> { return this.telephony.receiveEventForApi(callId, body, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/compensations") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") compensate(@Param("callId") callId: string, @Body() body: { idempotencyKey?: string; reasonCode?: string }, @Req() request: AuthenticatedRequest): Promise<CallRecord> { return this.telephony.compensateForApi(callId, body, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/association") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") associate(@Param("callId") callId: string, @Body() body: { leadId?: string }, @Req() request: AuthenticatedRequest): Promise<CallRecord> { if (!body.leadId) throw new BadRequestException({ code: "lead_id_required" }); return this.telephony.confirmAssociationForApi(callId, body.leadId, this.principal(request), this.correlation(request)); }
  @Get("telephony/queue") queue(@Req() request: AuthenticatedRequest): Promise<ReturnType<TelephonyService["queue"]>> { return this.telephony.queueForApi(this.principal(request)); }
  @Get("calls/:callId/recording") recording(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): Promise<ReturnType<TelephonyService["recording"]>> { return this.telephony.recordingForApi(callId, this.principal(request), this.correlation(request)); }
  @Get("integrations/telephony/webhook/status") webhookStatus(): ReturnType<TelephonyService["webhookStatus"]> { return this.telephony.webhookStatus(); }
  @Post("integrations/telephony/webhook") webhook(): never { return this.telephony.rejectRealWebhook(); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}

/** Dedicated machine endpoint. It never accepts a browser session as authority. */
@Controller("integrations/telephony/bridge/v1")
export class TelephonyBridgeController {
  constructor(@Inject(TelephonyService) private readonly telephony: TelephonyService) {}

  @Post("events")
  event(@Body() body: TelephonyBridgeEvent,
    @Headers("x-crm-bridge-id") bridgeId: string | undefined,
    @Headers("x-crm-bridge-timestamp") timestamp: string | undefined,
    @Headers("x-crm-bridge-nonce") nonce: string | undefined,
    @Headers("x-crm-bridge-signature") signature: string | undefined): Promise<CallRecord> {
    return this.telephony.receiveBridgeEventForApi(body, { bridgeId: bridgeId ?? "", timestamp: timestamp ?? "", nonce: nonce ?? "", signature: signature ?? "" });
  }
}

@Controller("telephony/provisioning")
@UseGuards(RbacGuard)
@RequireRoles("ADMIN", "SUPER_ADMIN")
export class TelephonyProvisioningController {
  constructor(@Inject(TelephonyAgentRepository) private readonly agents: TelephonyAgentRepository) {}
  @Get() list(@Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> { return this.agents.listProvisioning(this.principal(request)); }
  @Post("server-profiles") server(@Body() body: Parameters<TelephonyAgentRepository["upsertServerProfile"]>[0], @Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> { return this.agents.upsertServerProfile(body, this.principal(request)); }
  @Post("user-profiles") user(@Body() body: Parameters<TelephonyAgentRepository["upsertUserProfile"]>[0], @Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> { return this.agents.upsertUserProfile(body, this.principal(request)); }
  @Post("user-profiles/:profileId/pairing-codes") pairing(@Param("profileId") profileId: string, @Req() request: AuthenticatedRequest): ReturnType<TelephonyAgentRepository["createPairingCode"]> { return this.agents.createPairingCode(profileId, this.principal(request)); }
  @Patch("workstations/:workstationId/revoke") revoke(@Param("workstationId") workstationId: string, @Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> { return this.agents.revokeWorkstation(workstationId, this.principal(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}

@Controller("integrations/telephony/agent/v1")
export class TelephonyAgentController {
  constructor(
    @Inject(TelephonyAgentRepository) private readonly agents: TelephonyAgentRepository,
    @Inject(TelephonyService) private readonly telephony: TelephonyService,
  ) {}
  @Post("pair") pair(@Body() body: Parameters<TelephonyAgentRepository["pair"]>[0]): Promise<Record<string, unknown>> { return this.agents.pair(body); }
  @Post("status") async status(@Headers("x-telephony-agent-token") token: string | undefined, @Body() body: Parameters<TelephonyAgentRepository["status"]>[1]): Promise<Record<string, unknown>> { return this.agents.status(await this.agents.authenticate(token), body); }
  @Post("poll") async poll(@Headers("x-telephony-agent-token") token: string | undefined): ReturnType<TelephonyAgentRepository["poll"]> { return this.agents.poll(await this.agents.authenticate(token)); }
  @Post("events") async event(
    @Headers("x-telephony-agent-token") token: string | undefined,
    @Body() body: { schemaVersion?: string; commandId?: string; callId?: string; eventId?: string; state?: string; occurredAt?: string; reasonCode?: string },
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<CallRecord> {
    const identity = await this.agents.authenticate(token);
    if (body.schemaVersion !== "1" || !body.commandId || !body.callId || !body.eventId || !body.state || !body.occurredAt) throw new BadRequestException({ code: "telephony_agent_event_invalid" });
    await this.agents.assertEvent(identity, body.commandId, body.callId, body.state);
    const roles = identity.roles.filter(isRole);
    const scopes: Principal["scopes"] = identity.campusId
      ? [{ kind: "CAMPUS", id: identity.campusId }]
      : roles.includes("SUPER_ADMIN") ? [{ kind: "GLOBAL" }] : [];
    const principal: Principal = { userId: identity.userId, roles, scopes, sessionId: `agent-${identity.workstationId}` };
    const result = await this.telephony.receiveAgentEventForApi(body.callId, { idempotencyKey: body.eventId, state: body.state, occurredAt: body.occurredAt, ...(body.reasonCode ? { reasonCode: body.reasonCode } : {}) }, principal, correlationId ?? `agent-${identity.workstationId}`);
    await this.agents.markEventApplied(identity, body.callId, body.state);
    return result;
  }
}
