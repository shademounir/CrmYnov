import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { SessionService } from "../src/auth/session.service.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { ChatController } from "../src/chat/chat.controller.js";
import { CHAT_EDIT_WINDOW_MS, ChatService } from "../src/chat/chat.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import { UserService } from "../src/users/user.service.js";

function responseCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);
}

interface ChatFixture {
  audit: AuditService;
  users: UserService;
  leads: LeadService;
  notifications: NotificationService;
  service: ChatService;
  create: (suffix: string, roles?: Role[]) => Principal;
}

function fixture(): ChatFixture {
  const audit = new AuditService();
  const users = new UserService(new SessionService(), audit);
  const leads = new LeadService(audit);
  const notifications = new NotificationService(audit);
  const create = (suffix: string, roles: Role[] = ["ADMISSIONS"]): Principal => {
    const user = users.create({ professionalEmail: `${suffix}@example.invalid`, roles }, "bootstrap-synthetic", `create-${suffix}`);
    return { userId: user.id, roles, scopes: [{ kind: "GLOBAL" }], sessionId: `session-${suffix}` };
  };
  return { audit, users, leads, notifications, service: new ChatService(audit, users, leads, notifications), create };
}

test("creates collaborator-only direct and team conversations without duplicates", () => {
  const { service, create } = fixture();
  const author = create("author");
  const colleague = create("colleague");
  const direct = service.createConversation(author, { type: "DIRECT", participantIds: [colleague.userId] }, "conversation-direct");
  assert.deepEqual(direct.participantIds.sort(), [author.userId, colleague.userId].sort());
  assert.equal(service.createConversation(author, { type: "DIRECT", participantIds: [colleague.userId] }, "replay").id, direct.id);
  assert.equal(service.createConversation(author, { type: "TEAM", title: "Équipe synthétique", participantIds: [colleague.userId] }, "team").type, "TEAM");
  assert.throws(() => service.createConversation(author, { type: "DIRECT", participantIds: ["lead-synthetic"] }, "lead"), responseCode("chat_collaborator_required"));
  assert.throws(() => service.createConversation(author, { type: "TEAM", title: "Équipe", participantIds: [colleague.userId], attachments: [{}] }, "attachment"), responseCode("chat_attachments_deferred"));
});

test("enforces membership, idempotency, versioning, logical deletion and metadata-only audit", () => {
  const { service, create, audit } = fixture();
  const author = create("author");
  const colleague = create("colleague");
  const outsider = create("outsider");
  const conversation = service.createConversation(author, { type: "DIRECT", participantIds: [colleague.userId] }, "conversation");
  const first = service.postMessage(conversation.id, author, { content: "Message strictement synthétique", clientMessageId: "client-0001" }, "message");
  assert.equal(service.postMessage(conversation.id, author, { content: "Message strictement synthétique", clientMessageId: "client-0001" }, "replay").id, first.id);
  assert.equal(service.listMessages(conversation.id, colleague).items.length, 1);
  assert.throws(() => service.listMessages(conversation.id, outsider), responseCode("chat_conversation_not_found"));

  const edited = service.editMessage(first.id, author, { content: "Message synthétique corrigé", expectedVersion: 1 }, "edit");
  assert.equal(edited.version, 2);
  assert.equal(service.getVersionsForAudit(first.id)[0]?.content, "Message strictement synthétique");
  const receipt = service.markRead(conversation.id, first.id, colleague, "read");
  assert.deepEqual(service.markRead(conversation.id, first.id, colleague, "read-replay"), receipt);

  const deleted = service.deleteMessage(first.id, author, { reason: "Retrait synthétique", expectedVersion: 2 }, "delete");
  assert.equal(deleted.state, "DELETED");
  assert.equal(deleted.content, undefined);
  const auditJson = JSON.stringify(audit.list());
  assert.equal(auditJson.includes("Message strictement synthétique"), false);
  assert.equal(auditJson.includes("Message synthétique corrigé"), false);
});

test("expires author edits after 60 minutes while allowing reasoned moderation", () => {
  const { service, create } = fixture();
  const author = create("author");
  const colleague = create("colleague");
  const manager = create("manager", ["MANAGER"]);
  const conversation = service.createConversation(author, { type: "TEAM", title: "Équipe synthétique", participantIds: [colleague.userId, manager.userId] }, "conversation");
  const message = service.postMessage(conversation.id, author, { content: "Message synthétique", clientMessageId: "client-0002" }, "message");
  const originalNow = Date.now;
  Date.now = (): number => Date.parse(message.createdAt) + CHAT_EDIT_WINDOW_MS + 1;
  try {
    assert.throws(() => service.editMessage(message.id, author, { content: "Trop tard", expectedVersion: 1 }, "late"), responseCode("chat_edit_window_expired"));
    assert.equal(service.deleteMessage(message.id, manager, { reason: "Modération justifiée", expectedVersion: 1 }, "moderate").state, "DELETED");
  } finally {
    Date.now = originalNow;
  }
});

test("controller fails closed without an authenticated principal", () => {
  const { service } = fixture();
  const controller = new ChatController(service);
  assert.throws(() => controller.listConversations({} as never), responseCode("principal_missing"));
});

test("notifies mentioned members and requires explicit lead mutation rights for conversion", () => {
  const { service, create, leads, notifications } = fixture();
  const owner = create("owner");
  const colleague = create("colleague");
  const outsider = create("outsider");
  const lead = leads.registerLocalLead({
    leadCode: "LD-2026-CHAT0001",
    firstName: "Prénom synthétique",
    lastName: "Nom synthétique",
    campus: "Campus synthétique",
    campaign: "Campagne synthétique",
    educationLevel: "Niveau synthétique",
    program: "Programme synthétique",
    source: "SYNTHETIC",
    assignedToId: owner.userId,
  });
  const conversation = service.createConversation(owner, { type: "TEAM", title: "Décision synthétique", participantIds: [colleague.userId, outsider.userId], leadCode: lead.leadCode }, "linked");
  const message = service.postMessage(conversation.id, owner, { content: "Décision commerciale synthétique", clientMessageId: "client-mention-01", mentionUserIds: [colleague.userId] }, "mention");
  assert.equal(notifications.list(colleague, 1, 25).items[0]?.type, "CHAT_MENTION");
  assert.throws(() => service.postMessage(conversation.id, owner, { content: "Mention interdite", clientMessageId: "client-mention-02", mentionUserIds: ["unknown-user"] }, "bad-mention"), responseCode("chat_mention_invalid"));
  assert.throws(() => service.convertMessageToActivity(message.id, outsider, { type: "COMMENT", result: "DECISION_RECORDED" }, "forbidden"), responseCode("chat_lead_mutation_forbidden"));
  const activity = service.convertMessageToActivity(message.id, owner, { type: "COMMENT", result: "DECISION_RECORDED", includeMessageAsNote: true }, "convert");
  assert.equal(activity.leadId, lead.id);
  assert.throws(() => service.convertMessageToActivity(message.id, owner, { type: "COMMENT", result: "DECISION_RECORDED" }, "replay"), responseCode("chat_message_already_converted"));
});
