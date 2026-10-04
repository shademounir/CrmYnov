import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { TelephonyOwnController } from "../src/telephony/telephony-own.controller.js";
import type { TelephonyOwnService } from "../src/telephony/telephony-own.service.js";
import { TelephonyOwnService as OwnService } from "../src/telephony/telephony-own.service.js";
import { ownTelephonyReadiness, type OwnTelephonyHealth } from "../src/telephony/telephony-own.service.js";
import type { AuthenticatedRequest, Principal } from "../src/auth/auth.types.js";
import { routePermissions } from "../src/permissions/dynamic-routes.js";
import { permissionTransactionMode } from "../src/permissions/permission-transaction-routes.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";

test("own Telephony routes are closed, capability-bound and never treated as a lifecycle bypass", () => {
  assert.deepEqual(routePermissions("TelephonyOwnController", "read"), ["interaction.view"]);
  assert.deepEqual(routePermissions("TelephonyOwnController", "pairing"), ["interaction.create"]);
  assert.deepEqual(routePermissions("TelephonyOwnController", "revoke"), ["interaction.create"]);
  assert.equal(routePermissions("TelephonyOwnController", "configure"), null);
  assert.equal(permissionTransactionMode("TelephonyOwnController", "read"), "read");
  assert.equal(permissionTransactionMode("TelephonyOwnController", "pairing"), "write");
  assert.equal(permissionTransactionMode("TelephonyOwnController", "revoke"), "write");
  for (const method of ["read", "pairing", "revoke"] as const) {
    const handler: unknown = Object.getOwnPropertyDescriptor(TelephonyOwnController.prototype, method)?.value;
    if (typeof handler !== "function") assert.fail("Expected registered own controller handler");
    assert.equal(Reflect.getMetadata("__headers__", handler)?.[0]?.value, "private, no-store");
  }
});

test("own controller derives the actor solely from the authenticated request and rejects absence", async () => {
  const actor: Principal = { userId: "synthetic", sessionId: "synthetic", roles: ["ADMISSIONS"], scopes: [] };
  const seen: unknown[][] = [];
  const own = { read: (...args: unknown[]) => { seen.push(args); return Promise.resolve({}); }, pairing: (...args: unknown[]) => { seen.push(args); return Promise.resolve({}); }, revoke: (...args: unknown[]) => { seen.push(args); return Promise.resolve({}); } } as unknown as TelephonyOwnService;
  const controller = new TelephonyOwnController(own);
  const request = { principal: actor, header: () => "synthetic-correlation" } as unknown as AuthenticatedRequest;
  assert.throws(() => controller.read({} as AuthenticatedRequest), /Unauthorized/u);
  await controller.read(request); await controller.pairing({ expectedVersion: 1 }, request); await controller.revoke("synthetic-workstation", { expectedVersion: 2 }, request);
  assert.deepEqual(seen, [[actor], [{ expectedVersion: 1 }, actor, "synthetic-correlation"], ["synthetic-workstation", { expectedVersion: 2 }, actor, "synthetic-correlation"]]);
});

test("own mutations reject extra identity/scope fields, malformed versions and do not substitute in-memory persistence", async () => {
  const prisma = new PrismaService();
  const own = new OwnService(prisma, new DynamicPermissionRepository(prisma), new TelephonyAgentRepository(prisma));
  const actor: Principal = { userId: "synthetic", sessionId: "synthetic", roles: ["ADMISSIONS"], scopes: [] };
  try {
    for (const input of [{}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 1, userId: "other" }, { expectedVersion: 1, campus: "OTHER" }]) {
      assert.throws(() => own.pairing(input, actor, "test"), /Bad Request/u);
      assert.throws(() => own.revoke("synthetic", input, actor, "test"), /Bad Request/u);
    }
    if (!prisma.enabled) await assert.rejects(() => own.read(actor), /Service Unavailable/u);
  } finally { await prisma.onModuleDestroy(); }
});

test("readiness unit contract distinguishes disabled, unassigned, offline, SDK and SIP observations without fabricating success", () => {
  const now = new Date("2099-01-01T00:00:00Z").getTime();
  const ready: OwnTelephonyHealth = { globalEnabled: true, canCall: true, configured: true, profileEnabled: true, serverScopeValid: true, serverEnabled: true, activeCount: 1,
    workstation: { lastSeenAt: new Date(now), connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true } };
  assert.deepEqual(ownTelephonyReadiness(ready, now), { available: true, reason: null });
  for (const [change, reason] of [
    [{ globalEnabled: false }, "MODE_DISABLED"], [{ canCall: false }, "CALL_PERMISSION_REQUIRED"], [{ configured: false }, "USER_PROFILE_NOT_CONFIGURED"],
    [{ profileEnabled: false }, "USER_PROFILE_DISABLED"], [{ serverScopeValid: false }, "SERVER_PROFILE_SCOPE_MISMATCH"], [{ serverEnabled: false }, "SERVER_PROFILE_DISABLED"],
    [{ activeCount: 2 }, "WORKSTATION_AMBIGUOUS"], [{ activeCount: 0 }, "WORKSTATION_NOT_PAIRED"], [{ workstation: undefined }, "WORKSTATION_OFFLINE"],
  ] as Array<[Partial<OwnTelephonyHealth>, string]>) assert.deepEqual(ownTelephonyReadiness({ ...ready, ...change }, now), { available: false, reason });
  for (const [change, reason] of [
    [{ lastSeenAt: null }, "WORKSTATION_OFFLINE"], [{ lastSeenAt: new Date(now - 30_001) }, "WORKSTATION_OFFLINE"], [{ connectionState: "ERROR" }, "WORKSTATION_OFFLINE"],
    [{ sdkLoaded: false }, "SDK_NOT_LOADED"], [{ sipRegistered: false }, "SIP_NOT_REGISTERED"],
  ] as Array<[Partial<NonNullable<OwnTelephonyHealth["workstation"]>>, string]>) assert.equal(ownTelephonyReadiness({ ...ready, workstation: { ...ready.workstation!, ...change } }, now).reason, reason);
});
