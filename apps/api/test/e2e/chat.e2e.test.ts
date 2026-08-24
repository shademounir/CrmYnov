import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplication } from "../../src/application.js";
import { UserService } from "../../src/users/user.service.js";

test("runs the internal chat journey with member-only history and synthetic data", async (context) => {
  const app = await createApplication();
  const users = app.get(UserService);
  const author = users.create({ professionalEmail: "chat-author@example.invalid", roles: ["ADMISSIONS"] }, "bootstrap", "chat-author");
  const colleague = users.create({ professionalEmail: "chat-colleague@example.invalid", roles: ["ADMISSIONS"] }, "bootstrap", "chat-colleague");
  const outsider = users.create({ professionalEmail: "chat-outsider@example.invalid", roles: ["ADMISSIONS"] }, "bootstrap", "chat-outsider");
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);
  const base = `http://127.0.0.1:${address.port}`;

  const session = async (userId: string): Promise<string> => {
    const response = await fetch(`${base}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, roles: ["ADMISSIONS"] }) });
    assert.equal(response.status, 201);
    return (await response.json() as { token: string }).token;
  };
  const authorToken = await session(author.id);
  const colleagueToken = await session(colleague.id);
  const outsiderToken = await session(outsider.id);
  const jsonHeaders = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": "chat-e2e" });

  const create = await fetch(`${base}/chat/conversations`, { method: "POST", headers: jsonHeaders(authorToken), body: JSON.stringify({ type: "DIRECT", participantIds: [colleague.id] }) });
  assert.equal(create.status, 201);
  const conversation = await create.json() as { id: string };
  const send = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { method: "POST", headers: jsonHeaders(authorToken), body: JSON.stringify({ content: "Message E2E synthétique", clientMessageId: "chat-e2e-0001" }) });
  assert.equal(send.status, 201);
  const message = await send.json() as { id: string };

  const memberHistory = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { headers: { authorization: `Bearer ${colleagueToken}` } });
  assert.equal(memberHistory.status, 200);
  assert.equal((await memberHistory.json() as { total: number }).total, 1);
  const outsiderHistory = await fetch(`${base}/chat/conversations/${conversation.id}/messages`, { headers: { authorization: `Bearer ${outsiderToken}` } });
  assert.equal(outsiderHistory.status, 404);

  const receipt = await fetch(`${base}/chat/conversations/${conversation.id}/read-receipts`, { method: "POST", headers: jsonHeaders(colleagueToken), body: JSON.stringify({ messageId: message.id }) });
  assert.equal(receipt.status, 201);
  const specification = await fetch(`${base}/docs-json`).then((response) => response.json()) as { paths: Record<string, unknown> };
  assert.ok(specification.paths["/chat/conversations"]);
  assert.ok(specification.paths["/chat/conversations/{conversationId}/messages"]);
});
