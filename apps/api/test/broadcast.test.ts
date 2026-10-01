import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { SessionService } from "../src/auth/session.service.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { LocalBroadcastPublisher } from "../src/broadcast/broadcast.publisher.js";
import { BroadcastController } from "../src/broadcast/broadcast.controller.js";
import { BroadcastService } from "../src/broadcast/broadcast.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import { UserService } from "../src/users/user.service.js";

const responseCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

interface BroadcastFixture { audit: AuditService; users: UserService; notifications: NotificationService; service: BroadcastService; create: (suffix: string, roles: Role[], campusId?: string, teamId?: string) => Principal }

function fixture(): BroadcastFixture {
  const audit = new AuditService(); const sessions = new SessionService(); const users = new UserService(sessions, audit); const notifications = new NotificationService(audit);
  const service = new BroadcastService(audit, users, new LocalBroadcastPublisher(notifications));
  const create = (suffix: string, roles: Role[], campusId = "campus-a", teamId = "team-a"): Principal => { const user = users.create({ professionalEmail: `${suffix}@example.invalid`, roles, campusId, teamId }, "bootstrap-synthetic", `create-${suffix}`); return { userId: user.id, roles, scopes: roles.includes("MANAGER") ? [{ kind: "CAMPUS", id: campusId }] : [{ kind: "GLOBAL" }], sessionId: `session-${suffix}` }; };
  return { audit, users, notifications, service, create };
}

test("runs the complete frozen-audience broadcast contract without PII in audit", () => {
  const { audit, users, notifications, service, create } = fixture();
  const manager = create("manager", ["MANAGER"]); const adviserA = create("adviser-a", ["ADMISSIONS"]); const adviserB = create("adviser-b", ["ADMISSIONS"]); const admin = create("admin", ["SUPER_ADMIN"]); const outsider = create("outsider", ["MANAGER"], "campus-b", "team-b");
  const content = "Information interne strictement synthétique";
  assert.throws(() => service.create(adviserA, { title: "Interdit", content, audience: { roles: ["ADMISSIONS"] }, clientRequestId: "request-denied-01" }, "denied"), responseCode("broadcast_author_forbidden"));
  assert.throws(() => service.create(manager, { title: "Audience vide", content, audience: {}, clientRequestId: "request-empty-01" }, "empty"), responseCode("broadcast_audience_empty"));
  assert.throws(() => service.create(manager, { title: "Rôle invalide", content, audience: { roles: ["UNKNOWN"] }, clientRequestId: "request-role-01" }, "role"), responseCode("broadcast_audience_invalid"));
  assert.throws(() => service.create(manager, { title: "Hors périmètre", content, audience: { campusIds: ["campus-b"] }, clientRequestId: "request-scope-01" }, "scope"), responseCode("broadcast_audience_out_of_scope"));

  const draft = service.create(manager, { title: "Information interne", content, internalLink: "/notifications", audience: { campusIds: ["campus-a"], roles: ["ADMISSIONS"] }, clientRequestId: "request-draft-01" }, "draft");
  assert.equal(service.create(manager, { title: "Information interne", content, audience: { campusIds: ["campus-a"], roles: ["ADMISSIONS"] }, clientRequestId: "request-draft-01" }, "replay").id, draft.id);
  const preview = service.preview(draft.id, manager); assert.deepEqual(preview, { broadcastId: draft.id, version: 1, recipientCount: 2, mutated: false });
  const confirmed = service.confirm(draft.id, manager, { confirmed: true, expectedVersion: 1, expectedRecipientCount: 2, idempotencyKey: "confirm-draft-01" }, "confirm");
  assert.equal(confirmed.recipientCount, 2); assert.equal(confirmed.state, "CONFIRMED");
  assert.equal(service.confirm(draft.id, manager, { confirmed: true, expectedVersion: 1, expectedRecipientCount: 2, idempotencyKey: "confirm-draft-01" }, "replay").id, draft.id);

  users.updateAuthorization(adviserB.userId, { roles: ["ADMISSIONS"], campusId: "campus-b", teamId: "team-b", reason: "CAMPUS_CHANGE", confirmed: true }, admin.userId, "move-after-confirmation");
  assert.equal(service.recipientSnapshot(draft.id, admin).recipientIds.length, 2);
  assert.throws(() => service.recipientSnapshot(draft.id, manager), responseCode("broadcast_recipients_forbidden"));
  assert.equal(notifications.list(adviserA, 1, 25).items[0]?.type, "BROADCAST");
  const notification = notifications.list(adviserA, 1, 25).items[0]!; assert.ok(notifications.markRead(notification.id, adviserA, "read").readAt);
  assert.throws(() => notifications.markRead(notification.id, adviserB, "idor"), responseCode("notification_not_found"));
  assert.throws(() => service.cancel(draft.id, manager, { reason: "Trop tard", expectedVersion: 2 }, "cancel"), responseCode("broadcast_immutable"));
  assert.throws(() => service.correct(draft.id, outsider, { title: "Correction", content: "Correction synthétique", reason: "Erreur synthétique", clientRequestId: "correction-outside-01" }, "idor"), responseCode("broadcast_not_found"));
  const correction = service.correct(draft.id, manager, { title: "Correction interne", content: "Correction synthétique liée", reason: "Rectification synthétique", clientRequestId: "correction-request-01" }, "correction");
  assert.equal(correction.correctionOf, draft.id); assert.equal(notifications.list(adviserA, 1, 25).items[0]?.type, "BROADCAST_CORRECTION");
  const cancellable = service.create(manager, { title: "Brouillon annulable", content, audience: { explicitRecipientIds: [adviserA.userId] }, clientRequestId: "request-cancel-01" }, "draft-cancel");
  assert.equal(service.cancel(cancellable.id, manager, { reason: "Annulation synthétique", expectedVersion: 1 }, "cancel").state, "CANCELLED");
  assert.equal(service.list(manager, 1, 25).items.every((item) => !("recipientIds" in item)), true);
  const auditJson = JSON.stringify(audit.list(100)); assert.equal(auditJson.includes(content), false); assert.equal(auditJson.includes("@example.invalid"), false);
});

test("fails closed on audience drift, unsafe links and unauthenticated controller access", () => {
  const { service, create } = fixture(); const manager = create("manager", ["MANAGER"]); create("adviser", ["ADMISSIONS"]);
  assert.throws(() => service.create(manager, { title: "Lien externe", content: "Contenu synthétique", internalLink: "https://outside.invalid", audience: { roles: ["ADMISSIONS"] }, clientRequestId: "request-link-01" }, "link"), responseCode("broadcast_link_invalid"));
  const draft = service.create(manager, { title: "Audience stable", content: "Contenu synthétique", audience: { roles: ["ADMISSIONS"] }, clientRequestId: "request-drift-01" }, "draft");
  assert.throws(() => service.confirm(draft.id, manager, { confirmed: true, expectedVersion: 1, expectedRecipientCount: 99, idempotencyKey: "confirm-drift-01" }, "drift"), responseCode("broadcast_audience_changed"));
  assert.throws(() => new BroadcastController(service).list({} as never), responseCode("principal_missing"));
});
