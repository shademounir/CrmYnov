import type { PermissionTransactionMode } from "./permission-fence.js";

/** Reviewed server handlers only. An unknown/new handler never receives a shared lock. */
const readers: Readonly<Record<string, readonly string[]>> = {
  LeadController: ["list", "detail"],
  LeadTimelineController: ["list"],
  ReassignmentController: ["list"],
  ClosureController: ["list"],
  LeadCollaborationController: ["list"],
  UserController: ["list"],
  AssignmentController: ["config", "history"],
  IngestionController: ["provenance"],
  ImportMappingController: ["list"],
  CandidateDocumentController: ["checklist"],
  DocumentVerificationController: ["dashboard", "detail"],
  ImportWizardController: ["get"],
  ImportReviewController: ["list"],
  ImportReportController: ["get", "export"],
  SavedLeadViewController: ["list"],
  ViewSharingController: ["audiences", "received", "history", "read"],
  NotificationController: ["list"],
  ManagerDashboardController: ["read", "export"],
  PersonalDashboardController: ["read"],
  AssignmentDashboardController: ["read"],
  CommercialFunnelController: ["read"],
  CommercialPerformanceController: ["read"],
  SourceEffectivenessController: ["read"],
  SharedContributionController: ["read"],
  OperationalRiskController: ["read"],
  TelephonyController: ["configuration", "detail", "queue", "recording", "webhookStatus"],
  FollowUpController: ["list"],
  AppointmentController: ["list", "availability", "kpis", "detail"],
  ChatController: ["listConversations", "listMessages"],
  BroadcastController: ["list", "recipients"],
  ReferenceController: ["list", "readAvailability"],
  LeadTagController: ["list"],
  DynamicPermissionController: ["catalogue", "read", "preview", "history", "effective", "teams"],
};

export function permissionTransactionMode(controller: string, handler: string): PermissionTransactionMode {
  // These reads append only consultation evidence, never an authorization determinant.
  if (controller === "AuditController" && ["list", "detail"].includes(handler)) return "read-audited";
  return readers[controller]?.includes(handler) ? "read" : "write";
}

/** Identity lifecycles retain their own guards, but their changes exclude protected readers. */
export type PermissionLifecycle = "session" | "session-create" | "first-login" | "recovery";
export function lifecyclePermissionFence(controller: string, handler: string): PermissionLifecycle | undefined {
  if (controller === "SessionController" && handler === "create") return "session-create";
  if (controller === "SessionController" && ["revoke", "revokeUser"].includes(handler)) return "session";
  if (controller === "FirstLoginController" && handler === "change") return "first-login";
  if (controller === "AccessRecoveryController" && handler === "complete") return "recovery";
  return undefined;
}
