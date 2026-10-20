import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { FollowUpDueJobModule } from "../src/jobs/follow-up-due.module.js";
import { followUpDueFailure, runFollowUpDueJob } from "../src/jobs/follow-up-due.js";
import { FollowUpPersistenceRepository } from "../src/follow-up/follow-up-persistence.repository.js";
import { PrismaService } from "../src/persistence/prisma.service.js";

test("due job module has only persistence providers, no API/catalogue/authentication bootstrap", () => {
  assert.deepEqual(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FollowUpDueJobModule), [PrismaService, FollowUpPersistenceRepository]);
  assert.equal(Reflect.getMetadata(MODULE_METADATA.IMPORTS, FollowUpDueJobModule), undefined);
  assert.equal(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FollowUpDueJobModule), undefined);
});

test("bootstrap failure preserves an allowlisted HTTP response code and safe stage, never raw message", async () => {
  let attempts = 0;
  await assert.rejects(() => runFollowUpDueJob({ workersMode: "external", createContext: () => {
    attempts++; return Promise.reject(new ServiceUnavailableException({ code: "permission_store_unavailable", message: "postgresql://private:secret@host/db" }));
  }, now: () => new Date(0), write: () => assert.fail("No success before completed context") }), error => {
    assert.deepEqual(JSON.parse(followUpDueFailure(error)), { job: "follow-up-due", completed: false, code: "permission_store_unavailable", stage: "create_context" });
    return true;
  });
  assert.equal(attempts, 1);
});

for (const kind of ["disabled", "mark-failure", "close-failure", "both-failures"] as const) {
  test(`due job ${kind} closes once, reports no success, never replays business work`, async () => {
    let closed = 0; let calls = 0; const writes: string[] = [];
    await assert.rejects(() => runFollowUpDueJob({ workersMode: "external", createContext: () => Promise.resolve({
      get: token => { assert.equal(token, FollowUpPersistenceRepository); return { enabled: kind !== "disabled", markDue: (): Promise<{ due: number; notifications: number }> => {
        calls++;
        return kind === "mark-failure" || kind === "both-failures"
          ? Promise.reject(Object.assign(new Error("postgresql://private:secret@host/db"), { code: "P1001" }))
          : Promise.resolve({ due: 0, notifications: 0 });
      } }; },
      close: () => { closed++; return kind === "close-failure" || kind === "both-failures" ? Promise.reject(new Error("secret cleanup failure")) : Promise.resolve(); },
    }), now: () => new Date(0), write: value => writes.push(value) }), error => {
      const value = JSON.parse(followUpDueFailure(error)) as Record<string, unknown>;
      assert.equal(value.completed, false);
      assert.equal(value.stage, kind === "close-failure" ? "close_context" : "mark_due");
      assert.equal(value.code, kind === "disabled" ? "follow_up_due_persistence_required" : kind === "close-failure" ? "follow_up_due_job_failed" : "P1001");
      assert.doesNotMatch(JSON.stringify(value), /postgresql|private|secret|cleanup failure/u);
      return true;
    });
    assert.equal(closed, 1); assert.equal(calls, kind === "disabled" ? 0 : 1); assert.deepEqual(writes, []);
  });
}

test("job diagnostics never expose unknown errors, SQL text, connection strings or arbitrary response codes", () => {
  for (const error of [new Error("postgresql://private:secret@host/db"), new ServiceUnavailableException({ code: "postgresql://private:secret@host/db" }), { code: "SQL SELECT private" }, null]) {
    assert.deepEqual(JSON.parse(followUpDueFailure(error)), { job: "follow-up-due", completed: false, code: "follow_up_due_job_failed" });
  }
});

test("job success is emitted only after durable processing and context cleanup", async () => {
  const order: string[] = [];
  await runFollowUpDueJob({ workersMode: "external", createContext: () => Promise.resolve({ get: () => ({ enabled: true, markDue: (): Promise<{ due: number; notifications: number }> => { order.push("commit"); return Promise.resolve({ due: 1, notifications: 1 }); } }), close: () => { order.push("close"); return Promise.resolve(); } }), now: () => new Date(0), write: value => { order.push("success"); assert.deepEqual(JSON.parse(value), { job: "follow-up-due", completed: true, due: 1, notifications: 1 }); } });
  assert.deepEqual(order, ["commit", "close", "success"]);
});
