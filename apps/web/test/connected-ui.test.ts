import assert from "node:assert/strict";
import test from "node:test";
import { assignmentRequest } from "../app/_components/assignment-form.js";
import { mutationBody } from "../app/_components/api-mutation-form.js";
import { broadcastPayload } from "../app/_components/broadcast-draft-form.js";
import { apiString, displayApiValue, resourceObjects } from "../app/_components/connected-resource.js";

test("normalizes generic form values, booleans and identifier arrays", () => {
  const form = new FormData();
  form.set("title", "Synthétique"); form.set("confirmed", "on"); form.set("participantIds", "user-a, user-b, ");
  assert.deepEqual(mutationBody(form, ["participantIds"]), { title: "Synthétique", confirmed: true, participantIds: ["user-a", "user-b"] });
});

test("builds non-mutating preview and explicit assignment requests", () => {
  const preview = assignmentRequest("lead-a", "user-a", "preview", "ui-assignment:test-1");
  assert.equal(preview.preview, true); assert.equal(preview.endpoint, "/api/crm/lead-assignments/preview"); assert.deepEqual(preview.body, { idempotencyKey: "ui-assignment:test-1", strategy: "FIXED", targetUserId: "user-a", items: [{ leadId: "lead-a", source: "UI_LOCAL", campaign: "UI_LOCAL" }] });
  const confirm = assignmentRequest("lead a", "user-a", "confirm", "ui-assignment:test-2");
  assert.equal(confirm.preview, false); assert.equal(confirm.endpoint, "/api/crm/leads/lead%20a/assignment"); assert.deepEqual(confirm.body, { targetUserId: "user-a", confirmed: true, idempotencyKey: "ui-assignment:test-2" });
});

test("builds a bounded broadcast draft payload with a synthetic audience", () => {
  const form = new FormData(); form.set("title", "Information synthétique"); form.set("content", "Contenu synthétique"); form.set("campusId", "campus-a");
  assert.deepEqual(broadcastPayload(form, "ui-broadcast:test-1"), { title: "Information synthétique", content: "Contenu synthétique", audience: { campusIds: ["campus-a"] }, clientRequestId: "ui-broadcast:test-1" });
});

test("extracts only API objects and displays structured values safely", () => {
  assert.deepEqual(resourceObjects([{ id: "a" }, null, "ignored"]), [{ id: "a" }]);
  assert.deepEqual(resourceObjects({ items: [{ id: "b" }] }), [{ id: "b" }]);
  assert.deepEqual(resourceObjects({ events: [{ id: "c" }] }), [{ id: "c" }]);
  assert.deepEqual(resourceObjects({ users: [{ id: "d" }] }), [{ id: "d" }]);
  assert.deepEqual(resourceObjects({ conversations: [{ id: "e" }] }), [{ id: "e" }]);
  assert.deepEqual(resourceObjects("invalid"), []);
  assert.equal(displayApiValue(undefined), "—"); assert.equal(displayApiValue(false), "false"); assert.equal(displayApiValue({ nested: true }), "Donnée structurée");
  assert.equal(apiString({ id: 42 }, "id"), "42"); assert.equal(apiString({ nested: {} }, "nested", "fallback"), "fallback");
});
