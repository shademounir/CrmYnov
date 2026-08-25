/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { LeadWorkflowPersistenceRepository } from "../src/leads/lead-workflow-persistence.repository.js";
import type { ReassignmentRequest } from "../src/assignment/reassignment.service.js";
import type { CollaborationRequest } from "../src/collaboration/lead-collaboration.service.js";
import type { ClosureRequest } from "../src/closure/closure.service.js";

const leadId = "00000000-0000-4000-8000-000000000201";
const ownerId = "00000000-0000-4000-8000-000000000202";
const targetId = "00000000-0000-4000-8000-000000000203";
const now = new Date("2026-08-25T12:00:00.000Z");
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

type Row = Record<string, unknown> & { id: string };

function fakeRepository(): { repository: LeadWorkflowPersistenceRepository; rows: { reassignments: Row[]; collaborations: Row[]; closures: Row[] } } {
  const rows = { reassignments: [] as Row[], collaborations: [] as Row[], closures: [] as Row[] };
  const delegate = (items: Row[], kind: "reassignment" | "collaboration" | "closure") => ({
    findMany: async () => [...items],
    findUnique: async ({ where }: { where: Record<string, unknown> }) => items.find((item) => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
      const item = items.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
      if (!item) throw new Error("missing_test_row");
      return item;
    },
    create: async ({ data }: { data: Row }) => {
      const item: Row = { ...data, id: data.id, version: data.version ?? 1 };
      items.push(item); return item;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const item = items.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
      if (!item) return { count: 0 };
      for (const [key, value] of Object.entries(data)) item[key] = typeof value === "object" && value !== null && "increment" in value ? Number(item[key]) + Number((value as { increment: number }).increment) : value;
      return { count: 1 };
    },
    kind,
  });
  const client = {
    reassignmentRequest: delegate(rows.reassignments, "reassignment"),
    leadCollaborationRequest: delegate(rows.collaborations, "collaboration"),
    leadClosureRequest: delegate(rows.closures, "closure"),
    $transaction: async (value: unknown) => typeof value === "function" ? (value as (tx: unknown) => unknown)(client) : Promise.all(value as Promise<unknown>[]),
  };
  const prisma = { enabled: true, client } as unknown as PrismaService;
  return { repository: new LeadWorkflowPersistenceRepository(prisma), rows };
}

const reassignment = (): ReassignmentRequest => ({ id: "00000000-0000-4000-8000-000000000204", leadId, currentOwnerId: ownerId, targetUserId: targetId,
  reason: "Réaffectation synthétique", moveOpenTasks: true, requestedBy: ownerId, status: "PENDING", requestedAt: now.toISOString() });
const collaboration = (): CollaborationRequest => ({ id: "00000000-0000-4000-8000-000000000205", leadId, targetUserId: targetId,
  action: "ADD", role: "ADVISER", justification: "Collaboration synthétique", requesterId: ownerId, state: "PENDING", version: 1, createdAt: now.toISOString() });
const closure = (): ClosureRequest => ({ id: "00000000-0000-4000-8000-000000000206", leadId, target: "ENROLLED", reason: "ADMISSION_CONFIRMED",
  comment: "Clôture synthétique", evidence: ["SYNTHETIC_CHECK"], requesterId: ownerId, state: "PENDING", version: 1, createdAt: now.toISOString() });

test("persists workflow requests, hydrates them and replays reassignment idempotently", async () => {
  const { repository } = fakeRepository();
  assert.equal(repository.enabled, true);
  const first = await repository.createReassignment(reassignment(), "reassignment-synthetic-0001");
  const replay = await repository.createReassignment(reassignment(), "reassignment-synthetic-0001");
  assert.deepEqual(replay, first);
  assert.deepEqual(await repository.findReassignment("reassignment-synthetic-0001"), first);
  await repository.saveCollaboration(collaboration());
  await repository.saveClosure(closure());
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.reassignments.length, 1);
  assert.equal(snapshot.collaborations[0]?.state, "PENDING");
  assert.deepEqual(snapshot.closures[0]?.evidence, ["SYNTHETIC_CHECK"]);
});

test("rejects conflicting idempotence and stale workflow decisions", async () => {
  const { repository } = fakeRepository();
  await repository.createReassignment(reassignment(), "reassignment-synthetic-0002");
  await assert.rejects(() => repository.createReassignment({ ...reassignment(), targetUserId: ownerId }, "reassignment-synthetic-0002"), hasCode("reassignment_idempotency_conflict"));
  const decided = await repository.decideReassignment({ ...reassignment(), status: "APPROVED", decidedBy: targetId, decidedAt: now.toISOString(), decisionReason: "Validation synthétique" }, 1);
  assert.equal(decided.status, "APPROVED");
  await assert.rejects(() => repository.decideReassignment(decided, 1), hasCode("reassignment_concurrent_decision"));
});

test("uses optimistic versions for collaboration and closure decisions", async () => {
  const { repository } = fakeRepository();
  const collaborationRecord = await repository.saveCollaboration(collaboration());
  const approved = await repository.saveCollaboration({ ...collaborationRecord, state: "APPROVED", version: 2, decidedAt: now.toISOString(), decidedBy: targetId, decisionReason: "Validation synthétique" }, 1);
  assert.equal(approved.version, 2);
  await assert.rejects(() => repository.saveCollaboration(approved, 1), hasCode("collaboration_concurrent_decision"));
  const closureRecord = await repository.saveClosure(closure());
  const rejected = await repository.saveClosure({ ...closureRecord, state: "REJECTED", version: 2, decidedAt: now.toISOString(), decidedBy: targetId, decisionReason: "Justification synthétique" }, 1);
  assert.equal(rejected.state, "REJECTED");
  await assert.rejects(() => repository.saveClosure(rejected, 1), hasCode("closure_concurrent_decision"));
});

test("fails closed without a configured local PostgreSQL client", async () => {
  const repository = new LeadWorkflowPersistenceRepository({ enabled: false, client: undefined } as unknown as PrismaService);
  assert.equal(repository.enabled, false);
  assert.deepEqual(await repository.snapshot(), { reassignments: [], collaborations: [], closures: [] });
  assert.equal(await repository.findReassignment("missing-synthetic"), undefined);
  await assert.rejects(() => repository.saveClosure(closure()), /lead_workflow_persistence_unavailable/);
});
