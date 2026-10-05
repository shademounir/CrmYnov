import assert from "node:assert/strict";
import test from "node:test";
import { applicableCampusRule, parseCampusRules } from "../src/assignment/campus-assignment-policy.js";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../src/auth/auth.types.js";
import type { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import type { LeadService } from "../src/leads/lead.service.js";
import { PersistentAssignmentService } from "../src/assignment/persistent-assignment.service.js";
const fallback = { scope: "GLOBAL" as const, enabled: true };
const source = { scope: "SOURCE" as const, enabled: true, matchValue: "WEB_FORM" };
const campaign = { scope: "CAMPAIGN" as const, enabled: true, matchValue: "SYNTHETIC" };
test("campus priority selects Campaign, Source, fallback or no configuration", () => {
  assert.equal(applicableCampusRule([fallback, source, campaign], "WEB_FORM", "SYNTHETIC"), campaign);
  assert.equal(applicableCampusRule([fallback, source], "WEB_FORM", "SYNTHETIC"), source);
  assert.equal(applicableCampusRule([fallback], "WEB_FORM", "SYNTHETIC"), fallback);
  assert.equal(applicableCampusRule([], "WEB_FORM", "SYNTHETIC"), undefined);
  assert.throws(() => applicableCampusRule([fallback, campaign, campaign], "WEB_FORM", "SYNTHETIC"), /Conflict/u);
  assert.equal(applicableCampusRule([fallback, source, source, campaign], "WEB_FORM", "SYNTHETIC"), campaign, "lower-priority ambiguity does not replace Campaign");
});
test("persisted configuration rejects malformed rules instead of falling back", () => {
  assert.throws(() => parseCampusRules([{ ...campaign, strategy: "INVALID", candidates: [] }]));
  assert.throws(() => parseCampusRules([{ ...fallback, strategy: "ROUND_ROBIN", candidates: [{ userId: "synthetic", active: true, capacity: -1 }] }]));
  assert.deepEqual(parseCampusRules([]), []);
});

test("manual unassigned candidates retain the existing Manager contract, reassignment candidates remain Commercial-only", async () => {
  const campusId = "00000000-0000-4000-8000-000000000094";
  const leadId = "00000000-0000-4000-8000-000000000095";
  const actorId = "00000000-0000-4000-8000-000000000096";
  const managerId = "00000000-0000-4000-8000-000000000097";
  const actor: Principal = { userId: actorId, roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: campusId }], sessionId: "synthetic-session" };
  const campus = { id: campusId, kind: "CAMPUS", code: "CAMPUS_CODE", label: "Campus synthétique", state: "ACTIVE" };
  const manager = { id: managerId, active: true, firstLoginRequired: false, roles: ["MANAGER"], campusId, professionalDisplayName: "Manager synthétique", authenticationVersion: 1 };
  let owner: string | null = null;
  const tx = {
    collaborator: { findUnique: ({ where }: { where: { id: string } }) => Promise.resolve({ ...manager, id: where.id }) },
    localSession: { findUnique: () => Promise.resolve({ active: true, collaboratorId: actorId, authenticationVersion: 1, expiresAt: new Date(Date.now() + 60_000) }) },
    crmReference: { findUnique: () => Promise.resolve(campus) },
    crmReferenceKey: { findMany: ({ where }: { where: { referenceId?: string } }) => Promise.resolve(where.referenceId ? [{ key: "CAMPUS_CODE" }] : [{ reference: campus }]) },
    lead: { findUnique: () => Promise.resolve({ id: leadId, campus: "CAMPUS_CODE", source: "FORM", campaign: "Campaign", assignedToId: owner }), count: () => Promise.resolve(0) },
    campusAssignmentConfiguration: { findUnique: () => Promise.resolve({ campusId, version: 1 }) },
    campusAssignmentVersion: { findUniqueOrThrow: () => Promise.resolve({ version: 1, rules: [{ id: "existing-manual-rule", scope: "GLOBAL", enabled: true, strategy: "ROUND_ROBIN", candidates: [{ userId: managerId, active: true, capacity: 10, activeLeadCount: 0 }] }] }) },
  } as unknown as Prisma.TransactionClient;
  const repository = { readTransaction: <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) => callback(tx), snapshots: () => Promise.resolve([]) } as unknown as DynamicPermissionRepository;
  const service = new PersistentAssignmentService(repository, {} as LeadService);
  assert.equal((await service.candidateOptions(leadId, actor))[0]?.id, managerId);
  owner = actorId;
  assert.deepEqual(await service.candidateOptions(leadId, actor), []);
});
