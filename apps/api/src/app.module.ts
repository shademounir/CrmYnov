import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { RateLimitService } from "./auth/rate-limit.service.js";
import { RbacGuard } from "./auth/rbac.guard.js";
import { ResourceController } from "./auth/resource.controller.js";
import { SessionController } from "./auth/session.controller.js";
import { SessionService } from "./auth/session.service.js";

@Module({
  controllers: [HealthController, SessionController, ResourceController],
  providers: [SessionService, RateLimitService, RbacGuard],
})
export class AppModule {}
