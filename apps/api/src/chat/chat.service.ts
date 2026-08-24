import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type ActivityType, type LeadActivityRecord } from "../leads/lead.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { UserService } from "../users/user.service.js";

export const CHAT_EDIT_WINDOW_MS = 60 * 60 * 1000;
export const CHAT_RETENTION_MONTHS = 12;
export type ChatConversationType = "DIRECT" | "TEAM";

export interface ChatConversation {
  id: string;
  type: ChatConversationType;
  title?: string | undefined;
  leadId?: string | undefined;
  leadCode?: string | undefined;
  participantIds: string[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
  retentionUntil: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  content?: string | undefined;
  version: number;
  state: "ACTIVE" | "EDITED" | "DELETED";
  createdAt: string;
  editedAt?: string | undefined;
  deletedAt?: string | undefined;
  mentionUserIds: string[];
}

interface StoredConversation extends ChatConversation {
  participantIds: string[];
}

interface MessageVersion {
  version: number;
  content?: string | undefined;
  changedBy: string;
  change: "EDIT" | "DELETE";
  reason?: string | undefined;
  createdAt: string;
}

function lexicalCompare(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "variant", numeric: false });
}

function sanitizedConversation(record: StoredConversation): ChatConversation {
  return { ...record, participantIds: [...record.participantIds] };
}

function sanitizedMessage(record: Readonly<ChatMessage>): ChatMessage {
  return { ...record };
}

@Injectable()
export class ChatService {
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly messages = new Map<string, Readonly<ChatMessage>>();
  private readonly conversationMessages = new Map<string, string[]>();
  private readonly directConversations = new Map<string, string>();
  private readonly messageVersions = new Map<string, MessageVersion[]>();
  private readonly messageIdempotency = new Map<string, string>();
  private readonly readReceipts = new Map<string, { messageId: string; readAt: string }>();
  private readonly convertedMessages = new Map<string, string>();

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  createConversation(
    principal: Principal,
    input: { type?: string; title?: string; participantIds?: string[]; leadCode?: string; attachments?: unknown[] },
    correlationId: string,
  ): ChatConversation {
    this.assertActiveCollaborator(principal.userId);
    if (input.attachments?.length) throw new BadRequestException({ code: "chat_attachments_deferred" });
    if (input.type !== "DIRECT" && input.type !== "TEAM") throw new BadRequestException({ code: "chat_type_invalid" });
    const participantIds = [...new Set([principal.userId, ...(input.participantIds ?? [])])].sort(lexicalCompare);
    if (participantIds.length < 2 || participantIds.length > 50) throw new BadRequestException({ code: "chat_participants_invalid" });
    participantIds.forEach((participantId) => this.assertActiveCollaborator(participantId));

    const title = input.title?.trim();
    if (input.type === "DIRECT" && participantIds.length !== 2) throw new BadRequestException({ code: "chat_direct_participants_invalid" });
    if (input.type === "TEAM" && (!title || title.length < 2 || title.length > 120)) throw new BadRequestException({ code: "chat_title_invalid" });
    const linkedLead = input.leadCode ? this.resolveLead(input.leadCode, principal, correlationId) : undefined;

    const directKey = input.type === "DIRECT" ? `${participantIds.join(":")}:${linkedLead?.id ?? "unlinked"}` : undefined;
    const existingId = directKey ? this.directConversations.get(directKey) : undefined;
    if (existingId) return sanitizedConversation(this.conversations.get(existingId)!);

    const now = new Date(Date.now());
    const retention = new Date(now);
    retention.setUTCMonth(retention.getUTCMonth() + CHAT_RETENTION_MONTHS);
    const record: StoredConversation = {
      id: randomUUID(),
      type: input.type,
      title: input.type === "TEAM" ? title : undefined,
      leadId: linkedLead?.id,
      leadCode: linkedLead?.leadCode,
      participantIds,
      createdById: principal.userId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      retentionUntil: retention.toISOString(),
    };
    this.conversations.set(record.id, record);
    this.conversationMessages.set(record.id, []);
    if (directKey) this.directConversations.set(directKey, record.id);
    this.audit.record({
      eventType: "CHAT_CONVERSATION_CREATED",
      actorId: principal.userId,
      actorRoles: principal.roles,
      sessionId: principal.sessionId,
      correlationId,
      after: { conversationId: record.id, type: record.type, participantCount: participantIds.length, leadId: record.leadId },
      result: "SUCCESS",
      idempotencyKey: `chat-conversation-created:${record.id}`,
    });
    return sanitizedConversation(record);
  }

  listConversations(principal: Principal, page = 1, pageSize = 25): { items: ChatConversation[]; page: number; pageSize: number; total: number } {
    this.assertPagination(page, pageSize);
    this.assertActiveCollaborator(principal.userId);
    const records = [...this.conversations.values()]
      .filter((conversation) => conversation.participantIds.includes(principal.userId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return {
      items: records.slice((page - 1) * pageSize, page * pageSize).map(sanitizedConversation),
      page,
      pageSize,
      total: records.length,
    };
  }

  postMessage(
    conversationId: string,
    principal: Principal,
    input: { content?: string; clientMessageId?: string; mentionUserIds?: string[]; attachments?: unknown[] },
    correlationId: string,
  ): ChatMessage {
    const conversation = this.assertMember(conversationId, principal);
    if (input.attachments?.length) throw new BadRequestException({ code: "chat_attachments_deferred" });
    const content = this.validateContent(input.content);
    const clientMessageId = String(input.clientMessageId ?? "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(clientMessageId)) throw new BadRequestException({ code: "chat_message_idempotency_invalid" });
    const idempotencyKey = `${conversationId}:${clientMessageId}`;
    const existing = this.messageIdempotency.get(idempotencyKey);
    if (existing) return sanitizedMessage(this.messages.get(existing)!);

    const mentionUserIds = [...new Set(input.mentionUserIds ?? [])].sort(lexicalCompare);
    for (const userId of mentionUserIds) {
      if (userId === principal.userId || !conversation.participantIds.includes(userId)) throw new BadRequestException({ code: "chat_mention_invalid" });
      this.assertActiveCollaborator(userId);
    }

    const now = new Date(Date.now()).toISOString();
    const message: Readonly<ChatMessage> = Object.freeze({
      id: randomUUID(),
      conversationId,
      authorId: principal.userId,
      content,
      version: 1,
      state: "ACTIVE",
      createdAt: now,
      mentionUserIds,
    });
    this.messages.set(message.id, message);
    this.conversationMessages.get(conversationId)!.push(message.id);
    this.messageIdempotency.set(idempotencyKey, message.id);
    conversation.updatedAt = now;
    for (const userId of mentionUserIds) {
      this.notifications.create({
        recipientId: userId,
        type: "CHAT_MENTION",
        priority: "NORMAL",
        resourceType: "CHAT",
        resourceId: conversationId,
        href: `/chat/${conversationId}`,
      }, `chat-mention:${message.id}:${userId}`);
    }
    this.recordMessageAudit("CHAT_MESSAGE_CREATED", message, principal, correlationId);
    return sanitizedMessage(message);
  }

  listMessages(conversationId: string, principal: Principal, page = 1, pageSize = 50): { items: ChatMessage[]; page: number; pageSize: number; total: number } {
    this.assertPagination(page, pageSize);
    this.assertMember(conversationId, principal);
    const records = (this.conversationMessages.get(conversationId) ?? [])
      .map((messageId) => this.messages.get(messageId)!)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return {
      items: records.slice((page - 1) * pageSize, page * pageSize).map(sanitizedMessage),
      page,
      pageSize,
      total: records.length,
    };
  }

  editMessage(
    messageId: string,
    principal: Principal,
    input: { content?: string; expectedVersion?: number },
    correlationId: string,
  ): ChatMessage {
    const current = this.assertMessageMember(messageId, principal);
    if (current.authorId !== principal.userId) throw new NotFoundException({ code: "chat_message_not_found" });
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertWithinEditWindow(current);
    if (current.state === "DELETED") throw new ConflictException({ code: "chat_message_deleted" });
    const content = this.validateContent(input.content);
    const now = new Date(Date.now()).toISOString();
    this.appendVersion(current, principal.userId, "EDIT", now);
    const updated: Readonly<ChatMessage> = Object.freeze({ ...current, content, version: current.version + 1, state: "EDITED", editedAt: now });
    this.messages.set(messageId, updated);
    this.recordMessageAudit("CHAT_MESSAGE_EDITED", updated, principal, correlationId);
    return sanitizedMessage(updated);
  }

  deleteMessage(
    messageId: string,
    principal: Principal,
    input: { reason?: string; expectedVersion?: number },
    correlationId: string,
  ): ChatMessage {
    const current = this.assertMessageMember(messageId, principal);
    this.assertExpectedVersion(current, input.expectedVersion);
    if (current.state === "DELETED") return sanitizedMessage(current);
    const moderator = principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
    if (!moderator && current.authorId !== principal.userId) throw new NotFoundException({ code: "chat_message_not_found" });
    if (!moderator) this.assertWithinEditWindow(current);
    const reason = input.reason?.trim();
    if (!reason || reason.length < 3 || reason.length > 240) throw new BadRequestException({ code: "chat_deletion_reason_invalid" });
    const now = new Date(Date.now()).toISOString();
    this.appendVersion(current, principal.userId, "DELETE", now, reason);
    const updated: Readonly<ChatMessage> = Object.freeze({
      ...current,
      content: undefined,
      version: current.version + 1,
      state: "DELETED",
      deletedAt: now,
    });
    this.messages.set(messageId, updated);
    this.recordMessageAudit("CHAT_MESSAGE_DELETED", updated, principal, correlationId, reason);
    return sanitizedMessage(updated);
  }

  markRead(conversationId: string, messageId: string, principal: Principal, correlationId: string): { messageId: string; readAt: string } {
    this.assertMember(conversationId, principal);
    const message = this.messages.get(messageId);
    if (!message || message.conversationId !== conversationId) throw new NotFoundException({ code: "chat_message_not_found" });
    const key = `${conversationId}:${principal.userId}`;
    const current = this.readReceipts.get(key);
    if (current?.messageId === messageId) return { ...current };
    const receipt = { messageId, readAt: new Date(Date.now()).toISOString() };
    this.readReceipts.set(key, receipt);
    this.audit.record({
      eventType: "CHAT_READ_RECEIPT_UPDATED",
      actorId: principal.userId,
      actorRoles: principal.roles,
      sessionId: principal.sessionId,
      correlationId,
      after: { conversationId, messageId },
      result: "SUCCESS",
      idempotencyKey: `chat-read:${conversationId}:${principal.userId}:${messageId}`,
    });
    return { ...receipt };
  }

  convertMessageToActivity(
    messageId: string,
    principal: Principal,
    input: { type?: string; result?: string; includeMessageAsNote?: boolean },
    correlationId: string,
  ): LeadActivityRecord {
    const message = this.assertMessageMember(messageId, principal);
    const conversation = this.conversations.get(message.conversationId)!;
    if (!conversation.leadId) throw new ConflictException({ code: "chat_lead_context_required" });
    const lead = this.leads.getLead(conversation.leadId, principal, correlationId);
    const canMutate = lead.assignedToId === principal.userId || Boolean(lead.collaboratorIds?.includes(principal.userId)) ||
      principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
    if (!canMutate) throw new ForbiddenException({ code: "chat_lead_mutation_forbidden" });
    if (message.state === "DELETED") throw new ConflictException({ code: "chat_message_deleted" });
    const knownActivityId = this.convertedMessages.get(messageId);
    if (knownActivityId) throw new ConflictException({ code: "chat_message_already_converted", activityId: knownActivityId });
    const activity = this.leads.addActivity(conversation.leadId, {
      type: input.type as ActivityType,
      result: input.result ?? "",
      ...(input.includeMessageAsNote === true && message.content ? { note: message.content } : {}),
    }, principal, correlationId);
    this.convertedMessages.set(messageId, activity.id);
    this.audit.record({
      eventType: "CHAT_MESSAGE_CONVERTED_TO_ACTIVITY",
      actorId: principal.userId,
      actorRoles: principal.roles,
      sessionId: principal.sessionId,
      correlationId,
      after: { conversationId: conversation.id, messageId, leadId: conversation.leadId, activityId: activity.id, type: activity.type },
      result: "SUCCESS",
      idempotencyKey: `chat-message-converted:${messageId}`,
    });
    return activity;
  }

  getVersionsForAudit(messageId: string): ReadonlyArray<MessageVersion> {
    return (this.messageVersions.get(messageId) ?? []).map((version) => ({ ...version }));
  }

  private assertActiveCollaborator(userId: string): void {
    const user = this.users.list({ active: true }).find((candidate) => candidate.id === userId);
    if (!user) throw new ForbiddenException({ code: "chat_collaborator_required" });
  }

  private resolveLead(leadCode: string, principal: Principal, correlationId: string): { id: string; leadCode: string } {
    if (!/^LD-\d{4}-[A-Z0-9]{4,32}$/.test(leadCode.trim().toUpperCase())) throw new BadRequestException({ code: "chat_lead_code_invalid" });
    const candidate = this.leads.findLocalLeadByCode(leadCode);
    if (!candidate) throw new NotFoundException({ code: "lead_not_found" });
    const visible = this.leads.getLead(candidate.id, principal, correlationId);
    return { id: visible.id, leadCode: visible.leadCode };
  }

  private assertMember(conversationId: string, principal: Principal): StoredConversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !conversation.participantIds.includes(principal.userId)) throw new NotFoundException({ code: "chat_conversation_not_found" });
    this.assertActiveCollaborator(principal.userId);
    return conversation;
  }

  private assertMessageMember(messageId: string, principal: Principal): Readonly<ChatMessage> {
    const message = this.messages.get(messageId);
    if (!message) throw new NotFoundException({ code: "chat_message_not_found" });
    this.assertMember(message.conversationId, principal);
    return message;
  }

  private assertWithinEditWindow(message: Readonly<ChatMessage>): void {
    if (Date.now() - Date.parse(message.createdAt) > CHAT_EDIT_WINDOW_MS) throw new ConflictException({ code: "chat_edit_window_expired" });
  }

  private assertExpectedVersion(message: Readonly<ChatMessage>, expectedVersion?: number): void {
    if (!Number.isInteger(expectedVersion) || expectedVersion !== message.version) throw new ConflictException({ code: "chat_message_version_conflict" });
  }

  private assertPagination(page: number, pageSize: number): void {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException({ code: "chat_pagination_invalid" });
    }
  }

  private validateContent(value?: string): string {
    const content = value?.trim() ?? "";
    if (!content || content.length > 2000 || content.includes("\0")) throw new BadRequestException({ code: "chat_content_invalid" });
    return content;
  }

  private appendVersion(message: Readonly<ChatMessage>, changedBy: string, change: "EDIT" | "DELETE", createdAt: string, reason?: string): void {
    const versions = this.messageVersions.get(message.id) ?? [];
    versions.push({ version: message.version, content: message.content, changedBy, change, reason, createdAt });
    this.messageVersions.set(message.id, versions);
  }

  private recordMessageAudit(eventType: string, message: Readonly<ChatMessage>, principal: Principal, correlationId: string, reason?: string): void {
    this.audit.record({
      eventType,
      actorId: principal.userId,
      actorRoles: principal.roles,
      sessionId: principal.sessionId,
      correlationId,
      after: { conversationId: message.conversationId, messageId: message.id, version: message.version, state: message.state, reason },
      result: "SUCCESS",
      idempotencyKey: `${eventType.toLowerCase()}:${message.id}:${message.version}`,
    });
  }
}
