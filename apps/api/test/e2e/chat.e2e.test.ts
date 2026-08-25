import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplication } from "../../src/application.js";
import { UserService } from "../../src/users/user.service.js";
import { LeadService } from "../../src/leads/lead.service.js";
import { digestRecoveryValue, LocalCredentialAdapter } from "../../src/access-recovery/access-recovery.store.js";

test("runs the internal chat journey with member-only history and synthetic data", async (context) => {
  const app = await createApplication();
  const users = app.get(UserService);
  const leads = app.get(LeadService);
  const credentials = app.get(LocalCredentialAdapter);
  const author = users.create({ professionalEmail: "chat-author@example.invalid", roles: ["ADMISSIONS"], campusId: "Campus-synthetique" }, "bootstrap", "chat-author");
  const colleague = users.create({ professionalEmail: "chat-colleague@example.invalid", roles: ["ADMISSIONS"], campusId: "Campus-synthetique" }, "bootstrap", "chat-colleague");
  const outsider = users.create({ professionalEmail: "chat-outsider@example.invalid", roles: ["ADMISSIONS"], campusId: "Campus-autre" }, "bootstrap", "chat-outsider");
  const lead = leads.registerLocalLead({ leadCode: "LD-2026-CHAT0002", firstName: "Prénom synthétique", lastName: "Nom synthétique", campus: "Campus-synthetique", campaign: "Campagne synthétique", educationLevel: "Niveau synthétique", program: "Programme synthétique", source: "SYNTHETIC", assignedToId: author.id });
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);
  const base = `http://127.0.0.1:${address.port}`;

  const session = async (user: { id: string; professionalEmail: string }): Promise<string> => {
    credentials.provisionTemporary(user.id, "Temporary1!E2eValue", digestRecoveryValue(user.professionalEmail));
    credentials.replace(user.id, "Temporary1!E2eValue");
    const response = await fetch(`${base}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.professionalEmail, password: "Temporary1!E2eValue" }) });
    assert.equal(response.status, 201);
    return (await response.json() as { token: string }).token;
  };
  const authorToken = await session(author);
  const colleagueToken = await session(colleague);
  const outsiderToken = await session(outsider);
  const jsonHeaders = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": "chat-e2e" });

  const create = await fetch(`${base}/chat/conversations`, { method: "POST", headers: jsonHeaders(authorToken), body: JSON.stringify({ type: "DIRECT", participantIds: [colleague.id], leadCode: lead.leadCode }) });
  assert.equal(create.status, 201);
  const conversation = await create.json() as { id: string };
  const send = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { method: "POST", headers: jsonHeaders(authorToken), body: JSON.stringify({ content: "Message E2E synthétique", clientMessageId: "chat-e2e-0001", mentionUserIds: [colleague.id] }) });
  assert.equal(send.status, 201);
  const message = await send.json() as { id: string };

  const memberHistory = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { headers: { authorization: `Bearer ${colleagueToken}` } });
  assert.equal(memberHistory.status, 200);
  assert.equal((await memberHistory.json() as { total: number }).total, 1);
  const outsiderHistory = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { headers: { authorization: `Bearer ${outsiderToken}` } });
  assert.equal(outsiderHistory.status, 404);

  const receipt = await fetch(`${base}/chat/conversations/${conversation.id}/read-receipts`, { method: "POST", headers: jsonHeaders(colleagueToken), body: JSON.stringify({ messageId: message.id }) });
  assert.equal(receipt.status, 201);
  const notifications = await fetch(`${base}/notifications`, { headers: { authorization: `Bearer ${colleagueToken}` } });
  assert.equal(notifications.status, 200);
  assert.equal((await notifications.json() as { items: Array<{ type: string }> }).items[0]?.type, "CHAT_MENTION");
  const forbiddenConversion = await fetch(`${base}/chat/messages/${message.id}/convert-to-activity`, { method: "POST", headers: jsonHeaders(colleagueToken), body: JSON.stringify({ type: "COMMENT", result: "DECISION_RECORDED" }) });
  assert.equal(forbiddenConversion.status, 403);
  const conversion = await fetch(`${base}/chat/messages/${message.id}/convert-to-activity`, { method: "POST", headers: jsonHeaders(authorToken), body: JSON.stringify({ type: "COMMENT", result: "DECISION_RECORDED", includeMessageAsNote: true }) });
  assert.equal(conversion.status, 201);
  const specification = await fetch(`${base}/docs-json`).then((response) => response.json()) as { paths: Record<string, unknown> };
  assert.ok(specification.paths["/chat/conversations"]);
  assert.ok(specification.paths["/chat/conversations/{conversationId}/messages"]);
  assert.ok(specification.paths["/chat/messages/{messageId}/convert-to-activity"]);
});
