import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { reassignmentCandidateOptions } from "../src/assignment/reassignment-candidates.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import type { ConfigurationSnapshot } from "../src/permissions/dynamic-contract.js";
const campusId = "00000000-0000-4000-8000-000000000038";
function fixture(): { tx: Prisma.TransactionClient; configuredWithoutPool: () => void } {
  const campus = { id: campusId, kind: "CAMPUS", state: "ACTIVE", code: "CASABLANCA", label: "Casablanca synthétique" };
  let version = 0;
  const user = { id: "00000000-0000-4000-8000-000000000039", professionalDisplayName: "Conseillère synthétique", professionalEmail: "synthetic@example.invalid", active: true, firstLoginRequired: false, campusId, roles: ["ADMISSIONS"] };
  const tx = {
    crmReference: { findUnique: () => Promise.resolve(campus) },
    crmReferenceKey: { findMany: ({ where }: { where: { referenceId?: string } }) => Promise.resolve(where.referenceId ? [] : [{ reference: campus }]) },
    campusAssignmentConfiguration: { findUnique: () => Promise.resolve(version ? { campusId, version } : null) },
    campusAssignmentVersion: { findUniqueOrThrow: () => Promise.resolve({ version, rules: [] }) },
    collaborator: { findMany: ({ where, select, take }: { where: { active: boolean; firstLoginRequired: boolean; roles: { has: string }; campusId: { in: string[] }; id: { not: string } }; select: unknown; take: number }) => {
      assert.equal(where.active, true); assert.equal(where.firstLoginRequired, false); assert.equal(where.roles.has, "ADMISSIONS"); assert(where.campusId.in.includes(campusId)); assert.equal(where.id.not, "current-owner"); assert.equal(take, 501); assert.deepEqual(select, { id: true, professionalDisplayName: true, roles: true }); return Promise.resolve([user]);
    } }, lead: { count: () => Promise.resolve(17) },
  } as unknown as Prisma.TransactionClient;
  return { tx, configuredWithoutPool: (): void => { version = 1; } };
}
const lead = { campus: "CASABLANCA", campaign: "SYNTHETIC", source: "WEB_FORM", assignedToId: "current-owner" };
test("manual reassignment works without an automatic rule, with a minimized canonical-campus projection and no invented capacity", async () => {
  const f = fixture(), rows = await reassignmentCandidateOptions(f.tx, lead, []);
  assert.deepEqual(rows, [{ id: "00000000-0000-4000-8000-000000000039", label: "Conseillère synthétique", activeLeadCount: 17, capacity: null }]);
  assert.equal("professionalEmail" in rows[0]!, false);
});
test("an explicit configured routing exclusion is not bypassed by the no-configuration fallback", async () => {
  const f = fixture(); f.configuredWithoutPool(); assert.deepEqual(await reassignmentCandidateOptions(f.tx, lead, []), []);
});
test("manual target must retain effective Commercial lead view/edit/reminder capability", async () => {
  const f = fixture(), target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: "GLOBAL" };
  for (const key of ["lead.view", "lead.edit", "reminder.manage"]) {
    const config: ConfigurationSnapshot = { ...target, id: "synthetic", version: 1, grants: { ...defaultConfiguration(target), [key]: "NONE" } };
    assert.deepEqual(await reassignmentCandidateOptions(f.tx, lead, [config]), []);
  }
});
