import { Controller, Get } from "@nestjs/common";
import { health, type HealthStatus } from "@crm/shared";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthStatus { return health("api"); }
}
