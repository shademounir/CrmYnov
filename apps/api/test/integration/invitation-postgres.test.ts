import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { GmailInvitationSender } from "../../src/invitations/gmail-invitation.sender.js";

test("CRMY-161 HTTP/PostgreSQL invitation activates one synthetic Commercial and revokes its temporary session", { skip: process.env.CRMY161_EPHEMERAL_TEST !== "true" }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(database.pathname, "/crm_crmy161");
  const seedPassword = process.env.CRM_LOCAL_SEED_PASSWORD;
  assert.ok(seedPassword, "isolated seed credential is required");
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  try {
    const origin = await app.getUrl();
    const client = app.get(PrismaService).client!;
    let deliveredLink = "";
    const sender = app.get(GmailInvitationSender);
    sender.configured = (): boolean => true;
    sender.publicOrigin = (): string => "https://dev.example.invalid";
    sender.send = ({ link }): Promise<void> => { deliveredLink = link; return Promise.resolve(); };
    const request = (path: string, method: string, body?: object, token?: string): Promise<Response> => fetch(`${origin}${path}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const administratorLogin = await request("/sessions", "POST", { email: "super-admin@example.invalid", password: seedPassword });
    assert.equal(administratorLogin.status, 201);
    const administratorToken = (await administratorLogin.json() as { token: string }).token;
    const marker = randomUUID().slice(0, 8).toUpperCase();
    const campusResponse = await request("/references", "POST", { kind: "CAMPUS", code: `CRMY161-${marker}`, label: `Campus synthetic ${marker}`, scope: "GLOBAL", campusId: null }, administratorToken);
    assert.equal(campusResponse.status, 201);
    const campus = await campusResponse.json() as { id: string };
    const userResponse = await request("/users", "POST", { professionalEmail: `commercial-${marker}@example.invalid`, roles: ["ADMISSIONS"], campusId: campus.id }, administratorToken);
    assert.equal(userResponse.status, 201);
    const user = await userResponse.json() as { id: string };
    const temporaryResponse = await request(`/users/${user.id}/temporary-secret`, "POST", { reason: "INITIAL_ACCESS", confirmed: true }, administratorToken);
    assert.equal(temporaryResponse.status, 201);
    const temporary = (await temporaryResponse.json() as { temporarySecret: string }).temporarySecret;
    const temporaryLogin = await request("/sessions", "POST", { email: `commercial-${marker}@example.invalid`, password: temporary });
    assert.equal(temporaryLogin.status, 201);
    const restricted = await temporaryLogin.json() as { token: string; mustChangeSecret: boolean };
    assert.equal(restricted.mustChangeSecret, true);
    assert.equal((await request("/leads", "GET", undefined, restricted.token)).status, 403);
    const invitationResponse = await request(`/users/${user.id}/invitations`, "POST", { confirmed: true }, administratorToken);
    assert.equal(invitationResponse.status, 201);
    assert.deepEqual(await invitationResponse.json(), { state: "ACCEPTED_BY_GMAIL" });
    const code = new URLSearchParams(new URL(deliveredLink).hash.slice(1)).get("code");
    assert.ok(code);
    const before = await client.localAccessInvitation.findFirstOrThrow({ where: { collaboratorId: user.id } });
    assert.equal(before.state, "SENT", "GET link has no consuming endpoint");
    assert.notEqual(before.linkDigest, code);
    const nextSecret = "Synthetic-Commercial-2026!";
    const completion = await request("/invitations/completions", "POST", { code, nextSecret });
    assert.equal(completion.status, 201);
    assert.equal((await request("/invitations/completions", "POST", { code, nextSecret })).status, 409);
    assert.equal(await client.auditEvent.count({ where: { eventType: "ACCESS_INVITATION_COMPLETED", resourceId: user.id } }), 1);
    assert.equal((await client.localAccessInvitation.findFirstOrThrow({ where: { collaboratorId: user.id } })).state, "USED");
    assert.equal((await client.collaborator.findUniqueOrThrow({ where: { id: user.id } })).firstLoginRequired, false);
    assert.notEqual((await request("/sessions/current", "GET", undefined, restricted.token)).status, 200);
    assert.equal((await request("/sessions", "POST", { email: `commercial-${marker}@example.invalid`, password: temporary })).status, 403);
    const fresh = await request("/sessions", "POST", { email: `commercial-${marker}@example.invalid`, password: nextSecret });
    assert.equal(fresh.status, 201);
    const credential = await fresh.json() as { token: string; mustChangeSecret: boolean };
    assert.equal(credential.mustChangeSecret, false);
    const current = await request("/sessions/current", "GET", undefined, credential.token);
    assert.equal(current.status, 200);
    const profile = await current.json() as { roles: string[]; scopes: Array<{ kind: string; id: string }>; professionalEmail: string; campusLabel: string };
    assert.deepEqual(profile.roles, ["ADMISSIONS"]);
    assert.ok(profile.scopes.some((scope) => scope.kind === "CAMPUS" && scope.id === campus.id));
    assert.equal(profile.professionalEmail, `commercial-${marker.toLowerCase()}@example.invalid`);
    assert.equal(profile.campusLabel, `Campus synthetic ${marker}`);
    assert.equal((await request("/users", "GET", undefined, credential.token)).status, 403);
  } finally {
    await app.close();
  }
});
