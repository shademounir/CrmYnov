import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ChatService, type ChatConversation, type ChatMessage } from "./chat.service.js";

type ChatRequest = AuthenticatedRequest & { header(name: string): string | undefined };

@Controller("chat")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Post("conversations")
  createConversation(@Req() request: ChatRequest, @Body() body: { type?: string; title?: string; participantIds?: string[]; attachments?: unknown[] }): ChatConversation {
    return this.chat.createConversation(this.principal(request), body, this.correlationId(request));
  }

  @Get("conversations")
  listConversations(@Req() request: ChatRequest, @Query("page") page = "1", @Query("pageSize") pageSize = "25"): { items: ChatConversation[]; page: number; pageSize: number; total: number } {
    return this.chat.listConversations(this.principal(request), Number(page), Number(pageSize));
  }

  @Post("conversations/:conversationId/messages")
  postMessage(
    @Param("conversationId") conversationId: string,
    @Req() request: ChatRequest,
    @Body() body: { content?: string; clientMessageId?: string; attachments?: unknown[] },
  ): ChatMessage {
    return this.chat.postMessage(conversationId, this.principal(request), body, this.correlationId(request));
  }

  @Get("conversations/:conversationId/messages")
  listMessages(
    @Param("conversationId") conversationId: string,
    @Req() request: ChatRequest,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "50",
  ): { items: ChatMessage[]; page: number; pageSize: number; total: number } {
    return this.chat.listMessages(conversationId, this.principal(request), Number(page), Number(pageSize));
  }

  @Patch("messages/:messageId")
  editMessage(
    @Param("messageId") messageId: string,
    @Req() request: ChatRequest,
    @Body() body: { content?: string; expectedVersion?: number },
  ): ChatMessage {
    return this.chat.editMessage(messageId, this.principal(request), body, this.correlationId(request));
  }

  @Post("messages/:messageId/delete")
  deleteMessage(
    @Param("messageId") messageId: string,
    @Req() request: ChatRequest,
    @Body() body: { reason?: string; expectedVersion?: number },
  ): ChatMessage {
    return this.chat.deleteMessage(messageId, this.principal(request), body, this.correlationId(request));
  }

  @Post("conversations/:conversationId/read-receipts")
  markRead(
    @Param("conversationId") conversationId: string,
    @Req() request: ChatRequest,
    @Body() body: { messageId?: string },
  ): { messageId: string; readAt: string } {
    if (!body.messageId) throw new BadRequestException({ code: "chat_message_required" });
    return this.chat.markRead(conversationId, body.messageId, this.principal(request), this.correlationId(request));
  }

  private principal(request: ChatRequest): Principal {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return request.principal;
  }

  private correlationId(request: ChatRequest): string {
    return request.header("x-correlation-id") ?? "missing-correlation";
  }
}
