import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ViewSummary, ShareSummary } from "../../src/leads/view-sharing.contract.js";
import type { ConfigurationResponse } from "../../src/permissions/dynamic-responses.js";
import type { SharingFixture } from "./view-sharing-cycle.test.js";

type Actor = SharingFixture["adviser"];
type Mode = "ShareLock" | "ExclusiveLock";

/** Poll an observed SQL barrier with a deadline; no random scheduling delay. */
async function reached(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 12_000;
  while (!await condition()) {
    assert.ok(performance.now() < deadline, `SQL synchronization deadline: ${label}`);
    await new Promise<void>((done) => setTimeout(done, 20));
  }
}

async function fenceCount(client: PrismaClient, mode: Mode, granted: boolean): Promise<number> {
  const rows = await client.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype = 'advisory' AND classid = 169 AND objid = 1 AND mode = ${mode} AND granted = ${granted}`;
  return rows[0]?.count ?? 0;
}

/** The held table blocks handlers after acquisition of the authorization fence. */
async function blockedTable<T>(client: PrismaClient, scenario: (release: () => Promise<void>) => Promise<T>): Promise<T> {
  let acquired: () => void = () => { throw new Error("barrier_not_initialized"); };
  let unlock: () => void = () => { throw new Error("barrier_not_initialized"); };
  const ready = new Promise<void>((done) => { acquired = done; });
  const released = new Promise<void>((done) => { unlock = done; });
  const transaction = client.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE saved_lead_views IN ACCESS EXCLUSIVE MODE`;
    acquired(); await released;
  }, { timeout: 20_000 });
  await Promise.race([ready, transaction]);
  const release = async (): Promise<void> => { unlock(); await transaction; };
  try { return await scenario(release); } finally { await release(); }
}

async function stableReaders(client: PrismaClient, readers: (() => Promise<Response>)[], label: string): Promise<void> {
  const before = await client.rolePermissionEpoch.findUnique({ where: { id: 1 } });
  await blockedTable(client, async (release) => {
    const results = readers.map((read) => read());
    try {
      await reached(async () => await fenceCount(client, "ShareLock", true) >= readers.length, `${label}: both readers hold shared fence`);
      assert.equal(await fenceCount(client, "ExclusiveLock", true), 0, "readers never take the mutation fence");
    } finally { await release(); }
    for (const response of await Promise.all(results)) {
      assert.equal(response.status, 200, `${label}: stable authorized read`);
      await response.arrayBuffer();
    }
  });
  assert.deepEqual(await client.rolePermissionEpoch.findUnique({ where: { id: 1 } }), before, "reads do not advance the permission epoch");
}

async function readBeforeWrite(client: PrismaClient, read: () => Promise<Response>, write: () => Promise<Response>, writeStatus: number): Promise<void> {
  await blockedTable(client, async (release) => {
    const reading = read();
    let writing: Promise<Response> | undefined;
    try {
      await reached(async () => await fenceCount(client, "ShareLock", true) === 1, "reader authorized inside fence");
      writing = write();
      await reached(async () => await fenceCount(client, "ExclusiveLock", false) >= 1, "revocation waits behind reader");
    } finally { await release(); }
    const response = await reading;
    assert.equal(response.status, 200, "read linearized before revocation remains authorized");
    await response.arrayBuffer(); assert.ok(writing);
    assert.equal((await writing).status, writeStatus, "revocation commits after protected reader finishes");
  });
}

async function writeBeforeRead(client: PrismaClient, read: () => Promise<Response>, write: () => Promise<Response>): Promise<Response> {
  return blockedTable(client, async (release) => {
    const writing = write();
    let reading: Promise<Response> | undefined;
    try {
      await reached(async () => await fenceCount(client, "ExclusiveLock", true) === 1, "revocation acquired exclusive fence");
      reading = read();
      await reached(async () => await fenceCount(client, "ShareLock", false) >= 1, "reader waits behind revocation");
    } finally { await release(); }
    assert.equal((await writing).status, 201); assert.ok(reading);
    return reading;
  });
}

export async function assertPermissionConcurrency(client: PrismaClient, bases: string[], f: SharingFixture, freshReader: () => Promise<Actor>, report: (message: string) => void): Promise<void> {
  async function request(actor: Actor, path: string, method = "GET", body?: object, instance = 0): Promise<Response> {
    return fetch(`${bases[instance]}${path}`, { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json", "x-correlation-id": `permission-concurrency-${randomUUID()}` }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000) });
  }
  async function ok<T>(actor: Actor, path: string, method = "GET", body?: object): Promise<T> {
    const response = await request(actor, path, method, body);
    assert.equal(response.status, method === "POST" ? 201 : 200, `concurrency setup ${method} ${path}`);
    return response.json() as Promise<T>;
  }
  async function hidden(response: Response, status = 404): Promise<void> {
    assert.equal(response.status, status);
    const payload: unknown = await response.json();
    assert.ok(payload && typeof payload === "object" && "code" in payload);
    assert.deepEqual(Object.keys(payload), ["code"], "no resource or permission metadata in refusal");
  }
  const view = await ok<ViewSummary>(f.admin, "/lead-views", "POST", { name: "Barrière synthétique", filters: {} });
  const path = `/view-sharing/views/${view.id}`;
  let version = view.version;
  async function share(): Promise<ShareSummary> {
    const response = await ok<ViewSummary>(f.admin, `${path}/shares`, "POST", { expectedVersion: version, idempotencyKey: randomUUID(), kind: "CAMPUS", audienceId: f.campusA });
    version = response.version;
    const records = await ok<ShareSummary[]>(f.admin, "/view-sharing/history");
    const record = records.find((row) => row.viewId === view.id); assert.ok(record); return record;
  }
  let shared = await share();
  const read = (actor: Actor, instance: number): (() => Promise<Response>) => () => request(actor, path, "GET", undefined, instance);
  await stableReaders(client, [read(f.adviser, 0), read(f.manager, 1)], "two users / two compiled APIs");
  await stableReaders(client, [read(f.adviser, 0), read(f.adviser, 1)], "same user / two compiled APIs");
  await stableReaders(client, [read(f.adviser, 0), read(f.manager, 0)], "two users / same API");
  report("Deterministic shared SQL barriers: two users, same user, one/two APIs all HTTP 200; permission epoch unchanged.");

  const revoke = (): Promise<Response> => request(f.admin, `/view-sharing/shares/${shared.id}/revoke`, "POST", { expectedVersion: version, idempotencyKey: randomUUID() }, 1);
  await readBeforeWrite(client, read(f.adviser, 0), revoke, 201); version++;
  for (const instance of [0, 1]) await hidden(await request(f.adviser, path, "GET", undefined, instance));
  shared = await share();
  await hidden(await writeBeforeRead(client, read(f.adviser, 0), revoke)); version++;
  for (const instance of [0, 1]) await hidden(await request(f.adviser, path, "GET", undefined, instance));
  shared = await share();
  report("Read-before-revoke and revoke-before-read proved by SQL lock ownership/waiters; new reads after commit denied on both APIs without disclosure.");

  const teamView = await ok<ViewSummary>(f.manager, "/lead-views", "POST", { name: "Barrière équipe synthétique", filters: {} });
  const teamPath = `/view-sharing/views/${teamView.id}`;
  await ok(f.manager, `${teamPath}/shares`, "POST", { expectedVersion: 1, idempotencyKey: randomUUID(), kind: "TEAM", audienceId: f.responsibility });
  const responsibility = await client.teamResponsibility.findUniqueOrThrow({ where: { id: f.responsibility } });
  const responsibilityInput = { teamId: responsibility.teamId, campusId: responsibility.campusId, managerId: responsibility.managerId, expectedVersion: responsibility.version, confirmed: true, active: false };
  await readBeforeWrite(client, () => request(f.adviser, teamPath), () => request(f.superAdmin, "/admin/role-permissions/team-responsibilities", "POST", responsibilityInput, 1), 201);
  for (const instance of [0, 1]) await hidden(await request(f.adviser, teamPath, "GET", undefined, instance));
  await ok(f.superAdmin, "/admin/role-permissions/team-responsibilities", "POST", { ...responsibilityInput, expectedVersion: responsibility.version + 1, active: true });
  assert.equal((await request(f.adviser, teamPath, "GET", undefined, 1)).status, 200);
  report("Explicit TEAM responsibility revocation waits for protected reader then hides the shared view on both APIs; restoration uses audited versioned endpoint.");

  for (const campus of ["GLOBAL", f.campusA]) {
    const target = { kind: "ROLE", role: "ADMISSIONS", campus };
    const before = await ok<ConfigurationResponse>(f.superAdmin, `/admin/role-permissions/configuration?${new URLSearchParams(target)}`);
    // An inherited campus definition must retain the current narrower global role.
    const global = campus !== "GLOBAL" && before.inherited
      ? await ok<ConfigurationResponse>(f.superAdmin, "/admin/role-permissions/configuration?kind=ROLE&role=ADMISSIONS&campus=GLOBAL") : before;
    const baseline = global.grants;
    const input = { ...target, grants: { ...baseline, "lead.views.view": "NONE" }, expectedVersion: before.version, reason: "ACCESS_REVIEW", confirmed: true };
    await readBeforeWrite(client, read(f.adviser, 0), () => request(f.superAdmin, "/admin/role-permissions/configuration", "POST", input, 1), 201);
    for (const instance of [0, 1]) await hidden(await request(f.adviser, path, "GET", undefined, instance));
    await ok(f.superAdmin, "/admin/role-permissions/configuration", "POST", { ...input, grants: baseline, expectedVersion: before.version + 1 });
    assert.equal((await request(f.adviser, path, "GET", undefined, 1)).status, 200);
  }
  report("Concurrent global and campus permission changes wait for active reader, then revoke on both APIs; restored through versioned audited API.");

  for (const change of [
    { roles: ["AUDITOR"], campusId: f.campusA, teamId: "SYNTHETIC-TEAM", reason: "ACCESS_REVIEW" },
    { roles: ["ADMISSIONS"], campusId: f.campusA, teamId: "SYNTHETIC-OTHER", reason: "TEAM_CHANGE" },
    { roles: ["ADMISSIONS"], campusId: f.campusB, teamId: "SYNTHETIC-TEAM", reason: "CAMPUS_CHANGE" },
  ]) {
    const actor = await freshReader();
    const before = await client.collaborator.findUniqueOrThrow({ where: { id: actor.id } });
    await readBeforeWrite(client, read(actor, 0), () => request(f.superAdmin, `/users/${actor.id}/authorization`, "PATCH", { ...change, confirmed: true }, 1), 200);
    const after = await client.collaborator.findUniqueOrThrow({ where: { id: actor.id } });
    assert.deepEqual(after.roles, change.roles); assert.equal(after.campusId, change.campusId); assert.equal(after.teamId, change.teamId);
    assert.equal(after.authenticationVersion, before.authenticationVersion + 1);
    for (const instance of [0, 1]) await hidden(await request(actor, path, "GET", undefined, instance), 401);
  }
  report("Role, TEAM and CAMPUS changes serialize with protected reads and invalidate former identity on both APIs.");

  await hidden(await request(f.outsider, path));
  assert.equal((await request(f.auditor, `${path}/duplicate`, "POST", { expectedVersion: version, idempotencyKey: randomUUID(), name: "Interdit synthétique" })).status, 403);
  await readBeforeWrite(client, read(f.auditor, 0), () => request(f.superAdmin, `/users/${f.auditor.id}/status`, "PATCH", { active: false }, 1), 200);
  assert.equal((await client.collaborator.findUniqueOrThrow({ where: { id: f.auditor.id } })).active, false);
  for (const instance of [0, 1]) await hidden(await request(f.auditor, path, "GET", undefined, instance), 401);
  const audits = await client.auditEvent.count({ where: { resourceId: view.id } });
  const original = await client.savedLeadView.findUniqueOrThrow({ where: { id: view.id } });
  const updates = await Promise.all([0, 1].map((instance) => request(f.admin, `/lead-views/${view.id}`, "PATCH", { name: `Concurrent synthétique ${instance}`, filters: {}, expectedVersion: version }, instance)));
  assert.deepEqual(updates.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
  assert.equal((await client.savedLeadView.findUniqueOrThrow({ where: { id: view.id } })).version, original.version + 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: view.id } }), audits + 1);

  const revokeSessions = (): Promise<Response> => request(f.superAdmin, `/sessions/users/${f.adviser.id}/revoke`, "POST", {}, 1);
  await readBeforeWrite(client, read(f.adviser, 0), revokeSessions, 201);
  for (const instance of [0, 1]) await hidden(await request(f.adviser, path, "GET", undefined, instance), 401);
  const unseen = await freshReader();
  const unseenSession = await client.localSession.findFirstOrThrow({ where: { collaboratorId: unseen.id, active: true } });
  await readBeforeWrite(client, read(unseen, 0), () => request(f.superAdmin, `/sessions/${unseenSession.id}`, "DELETE", undefined, 1), 200);
  assert.equal((await client.localSession.findUniqueOrThrow({ where: { id: unseenSession.id } })).active, false, "API2 revokes a session it has never authenticated");
  for (const instance of [0, 1]) await hidden(await request(unseen, path, "GET", undefined, instance), 401);
  const epochBeforeAudit = await client.rolePermissionEpoch.findUnique({ where: { id: 1 } });
  const evidenceBeforeAudit = await client.auditEvent.count({ where: { eventType: { in: ["AUDIT_SEARCHED", "AUDIT_VIEWED"] } } });
  const audited = await client.auditEvent.findFirstOrThrow({ where: { resourceId: view.id } });
  const consultations = await Promise.all([
    request(f.superAdmin, "/audit-events", "GET", undefined, 0),
    request(f.superAdmin, `/audit-events/${audited.id}`, "GET", undefined, 1),
  ]);
  for (const response of consultations) { assert.equal(response.status, 200, "concurrent audit consultations remain readable"); await response.arrayBuffer(); }
  assert.deepEqual(await client.rolePermissionEpoch.findUnique({ where: { id: 1 } }), epochBeforeAudit, "audit consultation does not advance permission versions");
  assert.equal(await client.auditEvent.count({ where: { eventType: { in: ["AUDIT_SEARCHED", "AUDIT_VIEWED"] } } }), evidenceBeforeAudit + 2, "each authorized consultation appends exactly one evidence event");
  report("Audit list/detail on both APIs append exactly two consultation events without advancing the permission epoch.");
  assert.equal(await fenceCount(client, "ShareLock", true), 0); assert.equal(await fenceCount(client, "ExclusiveLock", true), 0);
  assert.equal(await fenceCount(client, "ShareLock", false), 0); assert.equal(await fenceCount(client, "ExclusiveLock", false), 0);
  const idle = await client.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`;
  assert.equal(idle[0]?.count, 0);
  report("Session revocation fenced; intercampus/AUDITOR refusals and optimistic mutation conflict preserved; no leftover fence or idle transaction.");
}
