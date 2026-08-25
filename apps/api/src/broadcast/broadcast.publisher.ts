import { Inject, Injectable } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service.js";

export interface BroadcastDelivery {
  broadcastId: string;
  recipientIds: readonly string[];
  correctionOf?: string | undefined;
}

export interface BroadcastPublisher {
  publish(delivery: BroadcastDelivery): { delivered: number };
}

@Injectable()
export class LocalBroadcastPublisher implements BroadcastPublisher {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  publish(delivery: BroadcastDelivery): { delivered: number } {
    for (const recipientId of delivery.recipientIds) {
      this.notifications.create({
        recipientId,
        type: delivery.correctionOf ? "BROADCAST_CORRECTION" : "BROADCAST",
        priority: "NORMAL",
        resourceType: "BROADCAST",
        resourceId: delivery.broadcastId,
        href: `/broadcasts/${delivery.broadcastId}`,
      }, `broadcast:${delivery.broadcastId}:recipient:${recipientId}`);
    }
    return { delivered: delivery.recipientIds.length };
  }
}
