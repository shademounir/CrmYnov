import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { localDatabaseUrl, localReadinessUrl, ready, runLocalMvpCheck, verifyOutboxConcurrency } from "../scripts/local-mvp-check.js";

type ClientState = { eventExists: boolean; claimed: boolean; delivered: boolean; probeExists: boolean };

function client(state: ClientState, createSucceeds: boolean): PrismaClient {
  return {
    collaborator: { count: () => Promise.resolve(5) },
    localPasswordHash: { count: () => Promise.resolve(5) },
    systemProbe: {
      upsert: () => { state.probeExists = true; return Promise.resolve({}); },
      findUnique: () => Promise.resolve(state.probeExists ? { id: "probe" } : null),
    },
    localOutboxEvent: {
      create: () => {
        if (!createSucceeds) return Promise.reject(new Error("duplicate"));
        state.eventExists = true;
        return Promise.resolve({ id: "event" });
      },
      findUnique: () => Promise.resolve(state.eventExists ? { id: "event" } : null),
      updateMany: (input: { where?: { status?: string }; data?: { status?: string } }) => {
        if (input.where?.status === "PENDING") {
          if (state.claimed) return Promise.resolve({ count: 0 });
          state.claimed = true;
          return Promise.resolve({ count: 1 });
        }
        if (input.where?.status === "PROCESSING" && input.data?.status === "DELIVERED" && state.claimed && !state.delivered) {
          state.delivered = true;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      },
    },
    $disconnect: () => Promise.resolve(),
  } as unknown as PrismaClient;
}

const successfulFetch = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ status: "ok", database: "ready" }), { status: 200, headers: { "content-type": "application/json" } }));

test("local contracts allow only the isolated Compose database and readiness endpoints", () => {
  assert.equal(localDatabaseUrl("postgresql://user:password@postgres:5432/local").hostname, "postgres");
  assert.equal(localReadinessUrl("http://api:3001/health/ready", "api").pathname, "/health/ready");
  for (const value of [undefined, "postgresql://localhost:5432/local", "postgresql://postgres:5433/local", "postgresql://postgres:5432/local?ssl=true"]) assert.throws(() => localDatabaseUrl(value), /local_database_url_/);
  for (const value of [undefined, "https://api:3001/health/ready", "http://localhost:3001/health/ready", "http://api:3001/health", "http://user:password@api:3001/health/ready"]) assert.throws(() => localReadinessUrl(value, "api"), /local_readiness_url_/);
});

test("readiness accepts only a healthy API and database response", async () => {
  const endpoint = localReadinessUrl("http://api:3001/health/ready", "api");
  await ready(endpoint, successfulFetch);
  await assert.rejects(() => ready(endpoint, () => Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))), /api_readiness_failed/);
});

test("outbox proof requires one unique write, one claim and one delivery", async () => {
  const state = { eventExists: false, claimed: false, delivered: false, probeExists: true };
  await verifyOutboxConcurrency(client(state, true), client(state, false), "crmy157:fixed");
  assert.equal(state.delivered, true);
  const duplicateState = { eventExists: false, claimed: false, delivered: false, probeExists: true };
  await assert.rejects(() => verifyOutboxConcurrency(client(duplicateState, false), client(duplicateState, false), "crmy157:duplicate"), /outbox_unique_concurrency_failed/);
});

test("full local check covers prepare and rejects an invalid mode", async () => {
  const state = { eventExists: false, claimed: false, delivered: false, probeExists: false };
  const base = {
    databaseUrl: "postgresql://user:password@postgres:5432/local",
    primaryReadyUrl: "http://api:3001/health/ready",
    secondaryReadyUrl: "http://api-secondary:3001/health/ready",
    primary: client(state, true), secondary: client(state, false), fetchFunction: successfulFetch,
  };
  const result = await runLocalMvpCheck({ ...base, mode: "prepare" });
  assert.equal(result.valid, true);
  assert.equal(result.pii, false);
  assert.equal(state.probeExists, true);
  await assert.rejects(() => runLocalMvpCheck({ ...base, mode: "invalid" }), /local_check_mode_invalid/);
});
