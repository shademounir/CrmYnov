import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { SessionService } from "../../src/auth/session.service.js";

test("CRMY-44 real HTTP API uses PostgreSQL, session authentication and reference policy", { skip: process.env.CRMY44_EPHEMERAL_TEST !== "true" }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(database.pathname, "/crm_crmy44");
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  try {
    const client = app.get(PrismaService).client!; const marker = randomUUID().slice(0, 8).toUpperCase();
    const user = await client.collaborator.create({ data: { professionalEmail: `reference-${marker}@example.invalid`, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
    const sessions = app.get(SessionService); const session = sessions.create(user.id, ["SUPER_ADMIN"], [{ kind: "GLOBAL" }]); await sessions.flush();
    const origin = await app.getUrl();
    const request = (path: string, method: string, data?: object): Promise<Response> => fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    assert.equal((await fetch(`${origin}/references?kind=TAG`)).status, 401);
    const create = async (kind: string, code: string): Promise<{ id: string; code: string }> => {
      const response = await request("/references", "POST", { kind, code, label: code, scope: "GLOBAL", campusId: null }); assert.equal(response.status, 201); return response.json() as Promise<{ id: string; code: string }>;
    };
    const campus = await create("CAMPUS", `API-${marker}`); const program = await create("PROGRAM", `B1-${marker}`); const campaign = await create("CAMPAIGN", `CAM-${marker}`);
    assert.equal((await request(`/references/${program.id}/availability/${campus.id}`, "POST", { active: true, expectedVersion: 0 })).status, 201);
    const leadInput = { firstName: "Lead", lastName: "Synthétique", email: `lead-${marker}@example.invalid`, campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC", source: "TEST" };
    const before = await client.auditEvent.count({ where: { actorId: user.id, eventType: "LEAD_CREATED" } });
    const rejected = await request("/leads", "POST", { ...leadInput, program: "UNKNOWN" });
    assert.equal(rejected.status, 422); const rejection = await rejected.json() as { code: string; field: string }; assert.equal(rejection.code, "REFERENCE_VALUE_UNKNOWN"); assert.equal(rejection.field, "program");
    assert.equal(await client.auditEvent.count({ where: { actorId: user.id, eventType: "LEAD_CREATED" } }), before);
    assert.equal((await request("/leads", "POST", { ...leadInput, roles: ["ADMIN"] })).status, 400);
    const created = await request("/leads", "POST", leadInput); assert.equal(created.status, 201);
    const lead = (await created.json() as { lead: { id: string; version: number } }).lead;
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).program, program.code);
    assert.equal(await client.auditEvent.count({ where: { actorId: user.id, eventType: "LEAD_CREATED" } }), before + 1);
    const tag = await create("TAG", `TAG-${marker}`);
    assert.equal((await request(`/leads/${lead.id}/tags`, "PATCH", { tagIds: [tag.id], expectedVersion: 1, idempotencyKey: `api-tags-${marker}` })).status, 200);
    const timeline = await request(`/leads/${lead.id}/timeline`, "GET"); assert.equal(timeline.status, 200);
    assert.ok((await timeline.json() as { events: { type: string }[] }).events.some((event) => event.type === "TAGS_CHANGED"));
  } finally { await app.close(); }
});
