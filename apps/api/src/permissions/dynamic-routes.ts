/** Closed binding to server controller/handler identifiers, never to browser-supplied names. */
const bindings: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  LeadController: { create: ["lead.create"], list: ["lead.view"], detail: ["lead.view"], update: ["lead.edit"] },
  LeadStatusController: { update: ["lead.edit"] },
  LeadTimelineController: { list: ["interaction.view"], create: ["interaction.create"], correct: ["interaction.create"] },
  LeadAssignmentController: { assignOne: ["lead.assign"], preview: ["lead.assign"], assignBatch: ["lead.assign"] },
  ReassignmentController: { create: ["lead.reassign.request"], list: ["lead.view"], decide: ["lead.reassign.approve"] },
  ClosureController: { request: ["lead.close.request"], list: ["lead.view"], decide: ["lead.close.approve"], cancel: ["lead.close.request"] },
  LeadCollaborationController: { request: ["lead.collaborators.manage"], list: ["lead.view"], decide: ["lead.collaborators.manage"] },
  UserController: { create: ["users.create"], list: ["users.view"], setStatus: ["users.disable"], updateAuthorization: ["users.roles.assign"] },
  QuickLeadController: { matches: ["lead.view"], submit: ["lead.create"] },
  AssignmentController: { config: ["lead.assign"], configure: ["settings.campus.manage"], simulate: ["lead.assign"], assign: ["lead.assign"], history: ["lead.assign"] },
  IngestionController: { ingest: ["import.execute"], confirmPersistent: ["import.execute", "import.confirm"], provenance: ["import.view"] },
  ImportMappingController: { list: ["import.view"], save: ["import.execute"], dryRun: ["import.execute"], confirm: ["import.confirm"] },
  ImportProfileController: { profile: ["import.view"] },
  ResourceController: { update: ["lead.edit"] },
  CandidateDocumentController: { generate: ["lead.edit"], checklist: ["lead.view"], upload: ["lead.edit"] },
  DocumentVerificationController: { dashboard: ["lead.view"], detail: ["lead.view"], verify: ["lead.edit"] },
  ImportWizardController: { start: ["import.execute"], reconcile: ["import.execute"], confirm: ["import.confirm"], get: ["import.view"] },
  ImportReviewController: { enqueue: ["import.execute"], list: ["import.view"], decide: ["import.review.resolve"] },
  ImportReportController: { create: ["import.execute"], get: ["import.view"], export: ["import.report.export"] },
  SavedLeadViewController: { list: ["lead.view"], create: ["lead.edit"], update: ["lead.edit"], remove: ["lead.edit"] },
  NotificationController: { list: ["lead.view"], markAll: ["notification.manage"], markRead: ["notification.manage"] },
  ManagerDashboardController: { read: ["reporting.view"], export: ["reporting.export"] },
  TelephonyController: { configuration: ["interaction.view"], configure: ["settings.global.manage"], initiate: ["interaction.create"], detail: ["interaction.view"], event: ["interaction.create"], compensate: ["interaction.create"], associate: ["interaction.create"], queue: ["interaction.view"], recording: ["interaction.view"], webhookStatus: ["interaction.view"], webhook: ["settings.global.manage"] },
};
const grouped: Readonly<Record<string, string>> = {
  FollowUpController: "reminder.manage", AppointmentController: "appointment.manage",
  ChatController: "chat.use", BroadcastController: "chat.broadcast",
  AssignmentDashboardController: "reporting.view", PersonalDashboardController: "reporting.view",
  CommercialFunnelController: "reporting.view", CommercialPerformanceController: "reporting.view",
  SourceEffectivenessController: "reporting.view", SharedContributionController: "reporting.view", OperationalRiskController: "reporting.view",
};
const groupedHandlers: Readonly<Record<string, readonly string[]>> = {
  FollowUpController: ["schedule", "list", "decide"], AppointmentController: ["create", "list", "availability", "kpis", "detail", "transition", "compensate", "report"],
  ChatController: ["createConversation", "listConversations", "postMessage", "listMessages", "editMessage", "deleteMessage", "markRead", "convertToActivity"],
  BroadcastController: ["create", "preview", "confirm", "cancel", "correct", "list", "recipients"],
};
// These controllers enforce their own permission or security lifecycle contract.
const delegated = new Set(["ReferenceController", "LeadTagController", "DynamicPermissionController", "AuditController"]);
export const lifecycleControllers = new Set(["HealthController", "SessionController", "AccessRecoveryController", "FirstLoginController", "ForminatorWebhookController"]);
export function routePermissions(controller: string, handler: string): readonly string[] | null {
  if (controller === "ChatController" && handler === "convertToActivity") return ["chat.use", "interaction.create"];
  if (delegated.has(controller)) return [];
  if (grouped[controller]) return (groupedHandlers[controller] ?? ["read"]).includes(handler) ? [grouped[controller]] : null;
  return bindings[controller]?.[handler] ?? null;
}

/** Extra gates are derived from the actual operation, not from a requested permission name. */
export function contextualPermissions(controller: string, keys: readonly string[], body: unknown, query: Record<string, unknown>, globalActor: boolean): readonly string[] {
  const status = body && typeof body === "object" && "status" in body ? body.status : undefined;
  if (controller === "LeadStatusController" && (status === "ENROLLED" || status === "CLOSED_LOST")) return [...keys, "lead.close.approve"];
  if (keys.some((key) => key.startsWith("reporting.")) && globalActor && !query.campus && !query.campusId) return [...keys, "reporting.global.view"];
  return keys;
}
