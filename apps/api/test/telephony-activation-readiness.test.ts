import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { TelephonyAgentRepository } from "../src/telephony/telephony-agent.repository.js";

const admin: Principal = { userId: "unpaired-admin", roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic" };
const profile = (): { enabled: boolean; sipAddress: string; user: { active: boolean; firstLoginRequired: boolean; roles: string[]; campusId: string }; serverProfile: { enabled: boolean; campusId: string | null }; workstations: Array<{ id: string; lastSeenAt: Date; connectionState: string; sdkLoaded: boolean; sipRegistered: boolean }> } => ({ enabled: true, sipAddress: "sip:synthetic@example.invalid", user: { active: true, firstLoginRequired: false, roles: ["MANAGER"], campusId: "campus-a" }, serverProfile: { enabled: true, campusId: "campus-a" }, workstations: [{ id: "station-a", lastSeenAt: new Date(), connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true }] });
type Profile = ReturnType<typeof profile>;
function fixture(rows: Array<{ id: string; userId: string }> = [{ id: "profile-a", userId: "manager-a" }], current: Profile | null = profile()): { repository: TelephonyAgentRepository; queries: Record<string, unknown>[]; reads: () => number } {
  let reads = 0; const queries: Record<string, unknown>[] = [];
  const repository = new TelephonyAgentRepository({ client: { telephonyUserProfile: {
    findMany: (query: Record<string, unknown>) => { queries.push(query); return Promise.resolve(rows); },
    findUnique: ({ where }: { where: { userId: string } }) => { reads++; assert.equal(where.userId, "manager-a"); return Promise.resolve(current); },
  } } } as unknown as PrismaService);
  return { repository, queries, reads: (): number => reads };
}

test("global activation observes a ready Manager without requiring an administrator workstation", async () => {
  const f = fixture(); const result = await f.repository.activationReadiness(admin);
  assert.deepEqual(result, { available: true, reason: "READY", identityLabel: "sip:synthetic@example.invalid" });
  assert.equal(f.reads(), 1);
  assert.deepEqual(f.queries[0]?.select, { id: true, userId: true }); assert.equal(f.queries[0]?.take, 100);
  const where = f.queries[0]?.where as Record<string, unknown>;
  assert.equal(where.enabled, true); assert.deepEqual(where.serverProfile, { enabled: true });
  const station = (where.workstations as { some: Record<string, unknown> }).some;
  assert.equal(station.active, true); assert.equal(station.connectionState, "CONNECTED"); assert.equal(station.sdkLoaded, true); assert.equal(station.sipRegistered, true);
  assert((station.lastSeenAt as { gte: Date }).gte instanceof Date);
});

test("activation refuses non-global administrators before reading any profile", async () => {
  for (const actor of [{ ...admin, roles: ["ADMIN"] as Principal["roles"] }, { ...admin, roles: ["MANAGER"] as Principal["roles"] }, { ...admin, scopes: [] }]) {
    const f = fixture(); await assert.rejects(f.repository.activationReadiness(actor)); assert.equal(f.queries.length, 0); assert.equal(f.reads(), 0);
  }
});

test("missing or vanished candidate never qualifies activation", async () => {
  for (const f of [fixture([]), fixture(undefined, null)]) assert.deepEqual(await f.repository.activationReadiness(admin), { available: false, reason: "NO_READY_WORKSTATION" });
});

const invalid: Array<[string, (p: Profile) => void]> = [
  ["disabled profile", (p): void => { p.enabled = false; }],
  ["disabled user", (p): void => { p.user.active = false; }],
  ["first login pending", (p): void => { p.user.firstLoginRequired = true; }],
  ["invalid role", (p): void => { p.user.roles = ["MANAGER", "UNKNOWN"]; }],
  ["ineligible role", (p): void => { p.user.roles = ["COMMERCIAL"]; }],
  ["disabled SIP server", (p): void => { p.serverProfile.enabled = false; }],
  ["server campus mismatch", (p): void => { p.serverProfile.campusId = "campus-b"; }],
  ["no active pairing", (p): void => { p.workstations = []; }],
  ["ambiguous pairing", (p): void => { p.workstations.push({ ...p.workstations[0]!, id: "station-b" }); }],
  ["expired heartbeat", (p): void => { p.workstations[0]!.lastSeenAt = new Date(Date.now() - 31_000); }],
  ["disconnected agent", (p): void => { p.workstations[0]!.connectionState = "OFFLINE"; }],
  ["SDK absent", (p): void => { p.workstations[0]!.sdkLoaded = false; }],
  ["SIP unregistered", (p): void => { p.workstations[0]!.sipRegistered = false; }],
];
for (const [name, change] of invalid) test(`activation rechecks ${name} instead of trusting the candidate query`, async () => {
  const p = profile(); change(p); const f = fixture(undefined, p);
  assert.deepEqual(await f.repository.activationReadiness(admin), { available: false, reason: "NO_READY_WORKSTATION" });
});

test("candidate pagination continues beyond a full page of invalidated profiles", async () => {
  let pages = 0; const row = profile(); const repository = new TelephonyAgentRepository({ client: { telephonyUserProfile: {
    findMany: (query: { cursor?: { id: string }; skip?: number }) => {
      pages++;
      if (pages === 1) return Promise.resolve(Array.from({ length: 100 }, (_, i) => ({ id: `old-${i}`, userId: `old-${i}` })));
      assert.deepEqual(query.cursor, { id: "old-99" }); assert.equal(query.skip, 1);
      return Promise.resolve([{ id: "ready", userId: "ready" }]);
    },
    findUnique: ({ where }: { where: { userId: string } }) => Promise.resolve(where.userId === "ready" ? row : null),
  } } } as unknown as PrismaService);
  assert.equal((await repository.activationReadiness(admin)).available, true); assert.equal(pages, 2);
});

test("bounded candidate inventory refuses rather than bypassing validation", async () => {
  let pages = 0; const repository = new TelephonyAgentRepository({ client: { telephonyUserProfile: {
    findMany: () => { pages++; return Promise.resolve(Array.from({ length: 100 }, (_, i) => ({ id: `page-${pages}-${i}`, userId: "gone" }))); },
    findUnique: () => Promise.resolve(null),
  } } } as unknown as PrismaService);
  assert.deepEqual(await repository.activationReadiness(admin), { available: false, reason: "ACTIVATION_INVENTORY_LIMIT" }); assert.equal(pages, 10);
});
