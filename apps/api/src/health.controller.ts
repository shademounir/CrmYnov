import { Controller, Get, Inject, Optional, ServiceUnavailableException } from "@nestjs/common";
import { health, type HealthStatus } from "@crm/shared";
import { PrismaService } from "./persistence/prisma.service.js";

export interface ReadinessStatus extends HealthStatus {
  database: "ready";
}

@Controller("health")
export class HealthController {
  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  @Get()
  getHealth(): HealthStatus { return health("api"); }

  @Get("ready")
  async getReadiness(): Promise<ReadinessStatus> {
    const client = this.prisma?.client;
    if (!client) throw new ServiceUnavailableException({ code: "database_unavailable" });
    try {
      await client.systemProbe.count();
      return { ...health("api"), database: "ready" };
    } catch {
      throw new ServiceUnavailableException({ code: "database_unavailable" });
    }
  }
}
