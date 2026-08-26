import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import type { Principal } from "../src/auth/auth.types.js";
import type { ReassignmentService } from "../src/assignment/reassignment.service.js";
import type { LeadService } from "../src/leads/lead.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { ReportingPersistenceGuard } from "../src/reporting/reporting-persistence.guard.js";
import { ReportingPersistenceService } from "../src/reporting/reporting-persistence.service.js";

const manager: Principal = {
  userId: "manager-synthetic",
  roles: ["MANAGER"],
  scopes: [{ kind: "CAMPUS", id: "campus-synthetic" }],
  sessionId: "session-synthetic",
};

test("refreshes persistent lead and reassignment projections before reporting", async () => {
  const calls: string[] = [];
  const service = new ReportingPersistenceService(
    { client: undefined } as PrismaService,
    { refreshReportingForApi: (): Promise<void> => { calls.push("leads"); return Promise.resolve(); } } as LeadService,
    { refreshReportingForApi: (): Promise<void> => { calls.push("reassignments"); return Promise.resolve(); } } as ReassignmentService,
  );
  await service.refresh();
  assert.deepEqual(calls.sort(), ["leads", "reassignments"]);
  assert.deepEqual(await service.evidence(manager, {}), {
    source: "LOCAL_SYNTHETIC_FALLBACK", distinctLeadCount: 0, appointmentCount: 0, documentMetadataCount: 0, importBatchCount: 0,
  });
  const guard = new ReportingPersistenceGuard(service);
  assert.equal(await guard.canActivate({} as ExecutionContext), true);
  assert.equal(calls.length, 4);
});

test("counts PostgreSQL evidence with fail-closed campus, adviser and period scope", async () => {
  const requests: Array<{ model: string; where: unknown }> = [];
  const count = (model: string) => (query: { where: unknown }): { model: string } => {
    requests.push({ model, where: query.where });
    return { model };
  };
  const client = {
    lead: { count: count("lead") }, appointment: { count: count("appointment") },
    candidateDocument: { count: count("document") }, ingestionBatch: { count: count("batch") },
    $transaction: (queries: unknown[]): Promise<number[]> => {
      assert.equal(queries.length, 4);
      return Promise.resolve([4, 3, 2, 1]);
    },
  };
  const noop = { refreshReportingForApi: (): Promise<void> => Promise.resolve() };
  const service = new ReportingPersistenceService(
    { client } as unknown as PrismaService, noop as LeadService, noop as ReassignmentService,
  );
  const evidence = await service.evidence(manager, {
    from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", campus: "campus-synthetic",
    adviserId: "adviser-synthetic", status: "QUALIFIED", source: "SYNTHETIC", campaign: "campaign-synthetic", program: "program-synthetic",
  });
  assert.deepEqual(evidence, { source: "POSTGRESQL", distinctLeadCount: 4, appointmentCount: 3, documentMetadataCount: 2, importBatchCount: 1 });
  const lead = requests.find((request) => request.model === "lead")?.where as Record<string, unknown>;
  assert.equal(lead.campus, "campus-synthetic");
  assert.deepEqual(lead.OR, [{ assignedToId: "adviser-synthetic" }, { collaborators: { some: { userId: "adviser-synthetic", active: true } } }]);
  assert.equal(JSON.stringify(requests).includes("firstName"), false);
});
