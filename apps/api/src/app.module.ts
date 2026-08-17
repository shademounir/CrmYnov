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
import { AuditController } from "./audit/audit.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { UserController } from "./users/user.controller.js";
import { UserService } from "./users/user.service.js";
import { FirstLoginController } from "./first-login/first-login.controller.js";
import { FirstLoginService } from "./first-login/first-login.service.js";

@Module({
  controllers: [HealthController, SessionController, ResourceController, AccessRecoveryController, AuditController, UserController, FirstLoginController],
  providers: [
    SessionService,
    RateLimitService,
    RbacGuard,
    AccessRecoveryService,
    LocalIdentityDirectory,
    LocalRecoveryChallengeStore,
    LocalCredentialAdapter,
    AuditService,
    UserService,
    FirstLoginService,
  ],
})
export class AppModule {}
