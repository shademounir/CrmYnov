import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LOCAL_SYNTHETIC_IDENTITIES } from "../prisma/seed-local.js";

const PROBE_ID = "15715715-7157-4157-8157-157157157157";

function localDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("local_database_url_missing");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "postgres" || (url.port && url.port !== "5432") || url.search) {
    throw new Error("local_database_url_refused");
  }
  return url;
}

async function ready(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  const body = await response.json() as { status?: string; database?: string };
  if (!response.ok || body.status !== "ok" || body.database !== "ready") throw new Error("api_readiness_failed");
}

async function verifyOutboxConcurrency(primary: PrismaClient, secondary: PrismaClient): Promise<void> {
  const idempotencyKey = `crmy157:${randomUUID()}`;
  const data = { topic: "LEAD.CREATED", aggregateType: "LEAD", aggregateId: "CRMY157_SYNTHETIC", idempotencyKey, payload: { operation: "VERIFY", version: 1 } };
  const writes = await Promise.allSettled([primary.localOutboxEvent.create({ data }), secondary.localOutboxEvent.create({ data })]);
  if (writes.filter((item) => item.status === "fulfilled").length !== 1 || writes.filter((item) => item.status === "rejected").length !== 1) {
    throw new Error("outbox_unique_concurrency_failed");
  }
  const event = await primary.localOutboxEvent.findUnique({ where: { idempotencyKey } });
  if (!event) throw new Error("outbox_event_missing");
  const now = new Date();
  const claims = await Promise.all([
    primary.localOutboxEvent.updateMany({ where: { id: event.id, status: "PENDING" }, data: { status: "PROCESSING", lockedBy: "crmy157-primary", lockedAt: now, attempts: { increment: 1 } } }),
    secondary.localOutboxEvent.updateMany({ where: { id: event.id, status: "PENDING" }, data: { status: "PROCESSING", lockedBy: "crmy157-secondary", lockedAt: now, attempts: { increment: 1 } } }),
  ]);
  if (claims.map((item) => item.count).sort().join(",") !== "0,1") throw new Error("outbox_claim_concurrency_failed");
  const delivered = await primary.localOutboxEvent.updateMany({ where: { id: event.id, status: "PROCESSING" }, data: { status: "DELIVERED", deliveredAt: new Date(), lockedAt: null, lockedBy: null } });
  if (delivered.count !== 1) throw new Error("outbox_delivery_failed");
}

async function main(): Promise<void> {
  localDatabaseUrl(process.env.DATABASE_URL);
  const mode = process.argv[2];
  if (mode !== "prepare" && mode !== "verify") throw new Error("local_check_mode_invalid");
  const primary = new PrismaClient();
  const secondary = new PrismaClient();
  try {
    await Promise.all([
      ready(process.env.CRM_PRIMARY_READY_URL ?? "http://api:3001/health/ready"),
      ready(process.env.CRM_SECONDARY_READY_URL ?? "http://api-secondary:3001/health/ready"),
    ]);
    const emails = LOCAL_SYNTHETIC_IDENTITIES.map((identity) => identity.professionalEmail);
    const [identityCount, passwordHashCount] = await Promise.all([
      primary.collaborator.count({ where: { professionalEmail: { in: emails } } }),
      primary.localPasswordHash.count({ where: { collaborator: { professionalEmail: { in: emails } } } }),
    ]);
    if (identityCount !== emails.length || passwordHashCount !== emails.length) throw new Error("synthetic_seed_incomplete");
    if (mode === "prepare") await primary.systemProbe.upsert({ where: { id: PROBE_ID }, create: { id: PROBE_ID }, update: {} });
    const persistenceProof = await secondary.systemProbe.findUnique({ where: { id: PROBE_ID } });
    if (!persistenceProof) throw new Error("restart_persistence_proof_missing");
    await verifyOutboxConcurrency(primary, secondary);
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, valid: true, mode, apiInstances: 2, syntheticIdentities: identityCount, passwordHashes: passwordHashCount, persistenceProof: true, outboxConcurrency: true, pii: false })}\n`);
  } finally {
    await Promise.allSettled([primary.$disconnect(), secondary.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "local_mvp_check_failed";
  process.stderr.write(`${JSON.stringify({ schemaVersion: 1, valid: false, errorCode: code })}\n`);
  process.exitCode = 1;
});
