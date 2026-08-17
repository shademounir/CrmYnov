import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { RateLimitService } from "./auth/rate-limit.service.js";
import { RbacGuard } from "./auth/rbac.guard.js";
import { ResourceController } from "./auth/resource.controller.js";
import { SessionController } from "./auth/session.controller.js";
import { SessionService } from "./auth/session.service.js";
import { AccessRecoveryController } from "./access-recovery/access-recovery.controller.js";
import { AccessRecoveryService } from "./access-recovery/access-recovery.service.js";
import {
  LocalCredentialAdapter,
  LocalIdentityDirectory,
  LocalRecoveryChallengeStore,
} from "./access-recovery/access-recovery.store.js";

@Module({
  controllers: [HealthController, SessionController, ResourceController, AccessRecoveryController],
  providers: [
    SessionService,
    RateLimitService,
    RbacGuard,
    AccessRecoveryService,
    LocalIdentityDirectory,
    LocalRecoveryChallengeStore,
    LocalCredentialAdapter,
  ],
})
export class AppModule {}
