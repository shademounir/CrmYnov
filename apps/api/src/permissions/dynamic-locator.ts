import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { AppointmentService } from "../appointments/appointment.service.js";
import { ChatService } from "../chat/chat.service.js";
import { FollowUpService } from "../follow-up/follow-up.service.js";
import { TelephonyService } from "../telephony/telephony.service.js";
import { permissionDenied } from "./dynamic-context.js";

/** Resolve secondary identifiers in their owning service, not from client claims.
 * The returned lead IDs are subsequently reloaded and authorized in PostgreSQL.
 */
@Injectable()
export class DynamicResourceLocator {
  constructor(
    @Inject(AppointmentService) private readonly appointments: AppointmentService,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(FollowUpService) private readonly followUps: FollowUpService,
    @Inject(TelephonyService) private readonly telephony: TelephonyService,
  ) {}
  leadIds(controller: string, handler: string, request: AuthenticatedRequest): string[] {
    const scalar = (value: unknown): string => typeof value === "string" ? value : permissionDenied();
    if (controller === "ChatController" && handler === "convertToActivity") {
      if (!request.principal) permissionDenied();
      return [this.chat.permissionLeadId(scalar(request.params.messageId), request.principal)];
    }
    if (controller === "FollowUpController" && handler === "decide") return [this.followUps.permissionLeadId(scalar(request.params.id))];
    if (controller === "AppointmentController" && request.params.id) return [this.appointments.permissionLeadId(scalar(request.params.id))];
    if (controller !== "TelephonyController" || !request.params.callId) return [];
    const existing = this.telephony.permissionLeadId(scalar(request.params.callId));
    const ids = existing ? [existing] : [];
    if (handler === "associate") {
      const body: unknown = request.body;
      if (!body || typeof body !== "object" || !("leadId" in body)) permissionDenied();
      ids.push(scalar(body.leadId));
    }
    return [...new Set(ids)];
  }
}
