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
import { LeadController, LeadStatusController, LeadTimelineController } from "./leads/lead.controller.js";
import { LeadService } from "./leads/lead.service.js";
import { AssignmentController } from "./assignment/assignment.controller.js";
import { AssignmentService } from "./assignment/assignment.service.js";
import { LeadAssignmentController } from "./assignment/lead-assignment.controller.js";
import { LeadAssignmentService } from "./assignment/lead-assignment.service.js";
import { ReassignmentController } from "./assignment/reassignment.controller.js";
import { ReassignmentService } from "./assignment/reassignment.service.js";
import { AssignmentDashboardController } from "./assignment/assignment-dashboard.controller.js";
import { AssignmentDashboardService } from "./assignment/assignment-dashboard.service.js";
import { IngestionController } from "./ingestion/ingestion.controller.js";
import { IngestionService } from "./ingestion/ingestion.service.js";
import { ImportProfileController } from "./import-profile/import-profile.controller.js";
import { ImportProfileService } from "./import-profile/import-profile.service.js";
import { ImportMappingController } from "./import-mapping/import-mapping.controller.js";
import { ImportMappingService } from "./import-mapping/import-mapping.service.js";
import { ImportReportController } from "./import-report/import-report.controller.js";
import { ImportReportService } from "./import-report/import-report.service.js";
import { ForminatorWebhookController } from "./forminator-webhook/forminator-webhook.controller.js";
import { ForminatorWebhookService } from "./forminator-webhook/forminator-webhook.service.js";
import { QuickLeadController } from "./quick-lead/quick-lead.controller.js";
import { QuickLeadService } from "./quick-lead/quick-lead.service.js";
import { ImportWizardController } from "./import-wizard/import-wizard.controller.js";
import { ImportWizardService } from "./import-wizard/import-wizard.service.js";
import { ImportReviewController } from "./import-review/import-review.controller.js";
import { ImportReviewService } from "./import-review/import-review.service.js";
import { NotificationController } from "./notifications/notification.controller.js";
import { NotificationService } from "./notifications/notification.service.js";
import { FollowUpController } from "./follow-up/follow-up.controller.js";
import { FollowUpService } from "./follow-up/follow-up.service.js";
import { ClosureController } from "./closure/closure.controller.js";
import { ClosureService } from "./closure/closure.service.js";
import { LeadCollaborationController } from "./collaboration/lead-collaboration.controller.js";
import { LeadCollaborationService } from "./collaboration/lead-collaboration.service.js";

@Module({
  controllers: [HealthController, SessionController, ResourceController, AccessRecoveryController, AuditController, UserController, FirstLoginController, LeadTimelineController, LeadStatusController, LeadController, QuickLeadController, AssignmentController, LeadAssignmentController, ReassignmentController, AssignmentDashboardController, IngestionController, ImportProfileController, ImportMappingController, ImportReportController, ImportWizardController, ImportReviewController, ForminatorWebhookController, NotificationController, FollowUpController, ClosureController, LeadCollaborationController],
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
    LeadService,
    AssignmentService,
    LeadAssignmentService,
    ReassignmentService,
    AssignmentDashboardService,
    IngestionService,
    ImportProfileService,
    ImportMappingService,
    ImportReportService,
    ForminatorWebhookService,
    QuickLeadService,
    ImportWizardService,
    ImportReviewService,
    NotificationService,
    FollowUpService,
    ClosureService,
    LeadCollaborationService,
  ],
})
export class AppModule {}
