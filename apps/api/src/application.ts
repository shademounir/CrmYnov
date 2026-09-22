import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { setup, serve } from "swagger-ui-express";
import { AppModule } from "./app.module.js";
import { correlationMiddleware } from "./correlation.middleware.js";
import { authenticationMiddleware } from "./auth/auth.middleware.js";
import { SessionService } from "./auth/session.service.js";
import { referencePaths } from "./references/reference.openapi.js";
import { dynamicPermissionPaths } from "./permissions/dynamic-openapi.js";
import { auditPaths } from "./audit/audit.openapi.js";
import { viewSharingPaths } from "./leads/view-sharing.openapi.js";
import { createCollaboratorBody } from "./users/user.openapi.js";
import { sheetImportPaths } from "./sheet-import/sheet-import.openapi.js";
import { leadQualificationPaths } from "./qualification/lead-qualification.openapi.js";

export async function createApplication(logLevel: "error" | "warn" | "log" = "error"): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: [logLevel] });
  configureApplication(app);
  return app;
}

export function configureApplication(app: INestApplication): void {
  app.use(correlationMiddleware);
  app.use(authenticationMiddleware(app.get(SessionService)));
  const corsOrigin = process.env.CRM_CORS_ORIGIN?.trim();
  if (corsOrigin) app.enableCors({ origin: corsOrigin, methods: ["GET", "POST", "DELETE", "PATCH"] });
  app.enableShutdownHooks();
  const openApi = {
    openapi: "3.0.3",
    info: { title: "CRM Admissions API", version: "0.1.0" },
    paths: {
      ...sheetImportPaths,
      ...referencePaths,
      ...dynamicPermissionPaths,
      ...auditPaths,
      ...viewSharingPaths,
      ...leadQualificationPaths,
      "/health": {
        get: {
          summary: "API operational health",
          responses: { "200": { description: "Service is healthy" } },
        },
      },
      "/health/ready": {
        get: {
          summary: "API and PostgreSQL readiness",
          responses: { "200": { description: "API and local database are ready" }, "503": { description: "Database unavailable" } },
        },
      },
      "/sessions": { post: { summary: "Authenticate a persistent local collaborator and create a short-lived session", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } } } } } }, responses: { "201": { description: "Session created" }, "403": { description: "Identity, credential or scope refused" }, "429": { description: "Rate limit exceeded" } } } },
      "/sessions/{sessionId}": { delete: { summary: "Revoke a session", responses: { "200": { description: "Revocation result" }, "403": { description: "Ownership required" } } } },
      "/sessions/users/{userId}/revoke": { post: { summary: "Revoke every active session for a user", responses: { "201": { description: "Sessions revoked" }, "403": { description: "SUPER_ADMIN required" } } } },
      "/resources/{resourceId}": { patch: { summary: "Update a resource within the caller ownership and scope", responses: { "200": { description: "Resource updated" }, "403": { description: "Resource unavailable" } } } },
      "/notifications": { get: { summary: "List the caller internal notifications with unread count", responses: { "200": { description: "Deterministic paginated notifications" }, "400": { description: "Invalid pagination" } } } },
      "/notifications/{id}/read": { patch: { summary: "Idempotently mark one owned notification as read", responses: { "200": { description: "Notification read" }, "404": { description: "Notification unavailable" } } } },
      "/notifications/read-all": { patch: { summary: "Idempotently mark all caller notifications as read", responses: { "200": { description: "Updated count" } } } },
      "/broadcasts": {
        get: { summary: "List authorized immutable internal broadcast history", responses: { "200": { description: "Deterministic page without recipient identities" }, "403": { description: "Manager role required" } } },
        post: { summary: "Create an idempotent internal broadcast draft", responses: { "201": { description: "Bounded draft without delivery" }, "400": { description: "Content, link or audience invalid" }, "403": { description: "Author or audience scope refused" } } },
      },
      "/broadcasts/{id}/preview": { post: { summary: "Preview the current authorized recipient count without mutation", responses: { "201": { description: "Aggregate count with mutated=false" }, "404": { description: "Draft unavailable" } } } },
      "/broadcasts/{id}/confirm": { post: { summary: "Explicitly confirm and freeze one recipient snapshot", responses: { "201": { description: "Exactly-once local internal delivery" }, "409": { description: "Version, preview count or confirmation conflict" } } } },
      "/broadcasts/{id}/cancel": { patch: { summary: "Cancel an owned draft before emission", responses: { "200": { description: "Draft cancelled" }, "409": { description: "Confirmed broadcast is immutable" } } } },
      "/broadcasts/{id}/corrections": { post: { summary: "Emit a linked compensating correction to the frozen audience", responses: { "201": { description: "Correction notification emitted" }, "400": { description: "Reason or content invalid" }, "404": { description: "Original unavailable" } } } },
      "/broadcasts/{id}/recipients": { get: { summary: "Read the frozen recipient identifiers as Admin only", responses: { "200": { description: "Immutable recipient snapshot" }, "403": { description: "Admin role required" } } } },
      "/leads/{leadId}/documents/checklist": { get: { summary: "Read the scoped candidate document checklist", responses: { "200": { description: "Sanitized checklist metadata" }, "404": { description: "Lead unavailable" } } }, post: { summary: "Generate one idempotent configurable candidate checklist", responses: { "201": { description: "Configured checklist" }, "400": { description: "Criteria invalid" } } } },
      "/leads/{leadId}/documents": { post: { summary: "Validate and store one synthetic document in temporary local storage", responses: { "201": { description: "Sanitized metadata; content never enters PostgreSQL" }, "400": { description: "Size, extension, MIME, signature or path refused" }, "503": { description: "Antivirus contract unavailable; fail-closed" } } } },
      "/candidate-documents/{id}": { get: { summary: "Read authorized metadata and immutable document events", responses: { "200": { description: "Metadata and append-only history" }, "404": { description: "Document unavailable" } } } },
      "/candidate-documents/{id}/verification": { patch: { summary: "Validate or refuse one document as an authorized Manager or Admin", responses: { "200": { description: "Controlled decision and internal notification" }, "400": { description: "Decision or refusal reason invalid" }, "409": { description: "Transition invalid" } } } },
      "/candidate-documents/dashboard": { get: { summary: "List operational dossier states with deterministic aggregate counters", responses: { "200": { description: "Paginated PII-free operational view and aggregate export" }, "403": { description: "Global view forbidden" } } } },
      "/telephony/configuration": { get: { summary: "Read the secret-free mode and observed bridge readiness", responses: { "200": { description: "Provider capability without credentials" } } }, patch: { summary: "Configure one explicit mode as Super Admin", description: "LINPHONE outbound activation additionally requires a reachable paired bridge, loaded SDK and registered SIP account.", responses: { "200": { description: "Versioned configuration" }, "403": { description: "Super Admin required" }, "409": { description: "Version conflict" }, "503": { description: "Bridge not ready" } } } },
      "/leads/{leadId}/calls": { post: { summary: "Persist then dispatch one idempotent outbound command from an authorized Lead", responses: { "201": { description: "Masked call and dispatch state; acceptance is not ringing" }, "404": { description: "Lead unavailable" }, "503": { description: "Provider or bridge unavailable" } } } },
      "/calls/{callId}": { get: { summary: "Read one scoped call without exposing its phone number", responses: { "200": { description: "Masked call state and immutable events" }, "404": { description: "Call or lead unavailable" } } } },
      "/calls/{callId}/end": { post: { summary: "Request termination of one active Linphone call without fabricating its final state", responses: { "201": { description: "Bridge acknowledgement or explicit uncertainty" }, "409": { description: "Call inactive or unsupported" }, "503": { description: "Bridge refusal" } } } },
      "/calls/{callId}/events": { post: { summary: "Append one idempotent structured synthetic call event", responses: { "201": { description: "Controlled state transition" }, "409": { description: "Impossible, conflicting or out-of-order event" } } } },
      "/calls/{callId}/compensations": { post: { summary: "Append a compensating call metadata event", responses: { "201": { description: "Immutable correction evidence" }, "403": { description: "Manager role required" } } } },
      "/calls/{callId}/association": { post: { summary: "Confirm an ambiguous call-to-lead association", responses: { "201": { description: "Human-confirmed association" }, "409": { description: "Phone fingerprint mismatch or already resolved" } } } },
      "/calls/{callId}/recording": { get: { summary: "Read restricted recording metadata only", responses: { "200": { description: "Opaque unavailable/restricted metadata; no audio or URL" }, "404": { description: "Metadata unavailable to caller" } } } },
      "/telephony/queue": { get: { summary: "List missed calls and associations requiring verification", responses: { "200": { description: "Sanitized operational queues" } } } },
      "/integrations/telephony/webhook/status": { get: { summary: "Confirm the real webhook is disabled", responses: { "200": { description: "enabled=false and stable reason" } } } },
      "/integrations/telephony/webhook": { post: { summary: "Reject every real event until separately secured and authorized", responses: { "503": { description: "telephony_webhook_disabled" } } } },
      "/integrations/telephony/bridge/v1/events": { post: { summary: "Accept one correlated HMAC-authenticated outbound SDK event", description: "Machine endpoint with paired bridge identity, timestamp, nonce and idempotent event key. It never accepts a browser session as authority.", responses: { "201": { description: "Observed state persisted" }, "400": { description: "Invalid event" }, "403": { description: "Bridge authentication refused" }, "404": { description: "Unknown command" }, "409": { description: "Duplicate conflict or out-of-order event" } } } },
      "/telephony/provisioning": { get: { summary: "List scoped, secret-free Liblinphone workstation provisioning", responses: { "200": { description: "Server profiles, user profiles and paired workstation health" }, "403": { description: "Admin role or campus scope refused" } } } },
      "/telephony/provisioning/server-profiles": { post: { summary: "Create or version one scoped SIP server profile without credentials", responses: { "201": { description: "Versioned server metadata" }, "400": { description: "Domain, proxy or transport invalid" }, "403": { description: "Admin scope refused" }, "409": { description: "Version conflict" } } } },
      "/telephony/provisioning/user-profiles": { post: { summary: "Bind one CRM user to one SIP identity without storing its password", responses: { "201": { description: "Versioned user profile" }, "403": { description: "Campus scope refused" }, "409": { description: "Dependency inactive or version conflict" } } } },
      "/telephony/provisioning/user-profiles/{profileId}/pairing-codes": { post: { summary: "Issue one short-lived, single-use workstation pairing code", responses: { "201": { description: "Ten-minute one-time code" }, "403": { description: "Admin scope refused" }, "409": { description: "Profile inactive or workstation already paired" } } } },
      "/telephony/provisioning/workstations/{workstationId}/revoke": { patch: { summary: "Revoke one paired workstation token", responses: { "200": { description: "Workstation revoked without changing SIP credentials" }, "403": { description: "Admin scope refused" }, "404": { description: "Workstation unavailable" } } } },
      "/integrations/telephony/agent/v1/pair": { post: { summary: "Exchange one pairing code for one device-bound opaque token", description: "Machine endpoint. The SIP password is never accepted by this API.", responses: { "201": { description: "Agent token returned once with secret-free profile" }, "401": { description: "Code invalid, expired or used" }, "409": { description: "Workstation already paired" } } } },
      "/integrations/telephony/agent/v1/status": { post: { summary: "Report SDK and SIP registration readiness from a paired workstation", responses: { "201": { description: "Observed workstation health" }, "401": { description: "Agent token refused" } } } },
      "/integrations/telephony/agent/v1/poll": { post: { summary: "Long-poll the next encrypted-at-rest outbound command without redelivery after claim", responses: { "201": { description: "At most one command, or null" }, "401": { description: "Agent token refused" } } } },
      "/integrations/telephony/agent/v1/events": { post: { summary: "Persist one correlated, idempotent Liblinphone SDK event", description: "DIALING, RINGING, ANSWERED and terminal states come from the local SDK; duration derives only from ANSWERED to a terminal event.", responses: { "201": { description: "Observed state persisted once" }, "401": { description: "Agent token refused" }, "404": { description: "Command/call correlation refused" }, "409": { description: "Conflicting replay or out-of-order transition" } } } },
      "/leads/{leadId}/appointments": { post: { summary: "Create one code-only lead appointment in Africa/Casablanca", responses: { "201": { description: "Appointment, internal notifications and append-only timeline event" }, "400": { description: "Type, mode, duration, campus or idempotency invalid" }, "404": { description: "Lead unavailable in caller scope" } } } },
      "/appointments": { get: { summary: "List scoped appointments with deterministic filters and pagination", responses: { "200": { description: "Day, week or operational table cohort without PII" } } } },
      "/lead-views": { get: { summary: "List the authenticated user's saved lead filter configurations" }, post: { summary: "Create a private saved lead view" } },
      "/lead-views/{id}": { patch: { summary: "Update the owner's saved lead view" }, delete: { summary: "Delete the owner's saved lead view" } },
      "/appointments/availability": { get: { summary: "Read bounded busy ranges without exposing another user's full agenda", responses: { "200": { description: "Redacted seven-day availability preview" }, "400": { description: "Period invalid" } } } },
      "/appointments/kpis": { get: { summary: "Read descriptive appointment and interview KPI definitions", responses: { "200": { description: "Aggregate counts, attendance, delays, results and workload without scoring" } } } },
      "/appointments/{id}": { get: { summary: "Read one authorized appointment, immutable events and redacted report", responses: { "200": { description: "Scoped appointment history" }, "404": { description: "Appointment unavailable" } } } },
      "/appointments/{id}/state": { patch: { summary: "Apply one controlled appointment transition with optimistic concurrency", responses: { "200": { description: "Versioned state and append-only event" }, "400": { description: "Reason missing, reschedule invalid, or outcome attempted before the scheduled end" }, "409": { description: "Transition, version, or idempotency key refused" } } } },
      "/appointments/{id}/compensations": { post: { summary: "Append a compensating correction without deleting history", responses: { "201": { description: "Compensating event" }, "403": { description: "Manager role required" } } } },
      "/appointments/{id}/interview-report": { post: { summary: "Validate one immutable, redacted human interview report", responses: { "201": { description: "Result recorded without automatic lead decision" }, "409": { description: "Appointment, evaluator or version refused" } } } },
      "/chat/conversations": {
        get: { summary: "List only the caller internal conversations", responses: { "200": { description: "Deterministic member-scoped conversations" }, "403": { description: "Active collaborator required" } } },
        post: { summary: "Create an internal direct or team conversation with optional lead context", responses: { "201": { description: "Collaborator-only conversation" }, "400": { description: "Invalid participants, title, lead code or deferred attachment" }, "403": { description: "Active collaborator required" }, "404": { description: "Lead context unavailable" } } },
      },
      "/chat/conversations/{conversationId}/messages": {
        get: { summary: "List the authorized conversation history", responses: { "200": { description: "Versioned messages with logical deletion state" }, "404": { description: "Conversation unavailable" } } },
        post: { summary: "Send one idempotent internal message and notify mentioned members", responses: { "201": { description: "Message accepted without external delivery" }, "400": { description: "Content, mention or idempotency key invalid" }, "404": { description: "Conversation unavailable" } } },
      },
      "/chat/messages/{messageId}": { patch: { summary: "Edit an owned message during the 60-minute window", responses: { "200": { description: "New version recorded" }, "404": { description: "Message unavailable" }, "409": { description: "Version conflict or edit window expired" } } } },
      "/chat/messages/{messageId}/delete": { post: { summary: "Logically delete an authorized message with a reason", responses: { "201": { description: "Content hidden and original version retained" }, "400": { description: "Reason invalid" }, "404": { description: "Message unavailable" } } } },
      "/chat/conversations/{conversationId}/read-receipts": { post: { summary: "Idempotently acknowledge one authorized message", responses: { "201": { description: "Read cursor updated" }, "404": { description: "Message or conversation unavailable" } } } },
      "/chat/messages/{messageId}/convert-to-activity": { post: { summary: "Explicitly convert a linked decision into an official lead activity", responses: { "201": { description: "Append-only lead activity created" }, "403": { description: "Lead mutation right required" }, "404": { description: "Message unavailable" }, "409": { description: "Message deleted, unlinked or already converted" } } } },
      "/leads/{leadId}/follow-ups": { post: {
        summary: "Schedule one persistent, idempotent lead follow-up",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["dueAt", "reason", "idempotencyKey"], properties: { dueAt: { type: "string", format: "date-time" }, reason: { type: "string", minLength: 3, maxLength: 1000 }, ownerId: { type: "string", format: "uuid" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 96 } } } } } },
        responses: { "201": { description: "Follow-up, Lead next action, activity, receipt and audit committed atomically" }, "400": { description: "Date, reason or idempotency invalid" }, "403": { description: "Owner, scope or permission required" }, "409": { description: "Active follow-up, replay conflict or concurrent Lead mutation" } },
      } },
      "/follow-ups": { get: { summary: "List authorized follow-ups in deterministic due order", responses: { "200": { description: "Authorized follow-ups" } } } },
      "/follow-ups/{id}": { patch: { summary: "Postpone, complete or cancel persistently with idempotence and optimistic concurrency", responses: { "200": { description: "Follow-up, Lead next action, activity, receipt and audit committed atomically" }, "409": { description: "Concurrent, final or idempotency decision refused" } } } },
      "/leads/{leadId}/closure-requests": { post: { summary: "Request an ENROLLED or CLOSED_LOST transition without changing status", responses: { "201": { description: "Pending closure request" }, "400": { description: "Invalid controlled evidence" }, "409": { description: "Pending request exists" } } } },
      "/closure-requests": { get: { summary: "List authorized closure requests", responses: { "200": { description: "Requests and decision history" } } } },
      "/closure-requests/{id}/decision": { patch: { summary: "Approve or reject as a distinct Manager/Admin", responses: { "200": { description: "Decision recorded" }, "403": { description: "Role separation refused" }, "409": { description: "Concurrent decision" } } } },
      "/closure-requests/{id}/cancel": { patch: { summary: "Cancel an owned pending request", responses: { "200": { description: "Request cancelled" }, "409": { description: "Request already final" } } } },
      "/leads/{leadId}/collaboration-requests": { post: { summary: "Request a controlled secondary collaborator change", responses: { "201": { description: "Pending request without access change" }, "409": { description: "Duplicate or conflicting request" } } } },
      "/collaboration-requests": { get: { summary: "List authorized secondary collaborator decisions", responses: { "200": { description: "Decision history" } } } },
      "/collaboration-requests/{id}/decision": { patch: { summary: "Approve or reject as a distinct Manager/Admin", responses: { "200": { description: "Decision recorded" }, "403": { description: "Role separation refused" }, "409": { description: "Concurrent decision" } } } },
      "/users": { get: { summary: "Filter collaborators", responses: { "200": { description: "Collaborators" }, "403": { description: "SUPER_ADMIN required" } } }, post: { summary: "Create a collaborator", requestBody: createCollaboratorBody, responses: { "201": { description: "Collaborator created" }, "403": { description: "SUPER_ADMIN required or invalid professional name" } } } },
      "/users/{id}/status": { patch: { summary: "Activate or deactivate a collaborator", responses: { "200": { description: "Status updated and sessions revoked when needed" }, "409": { description: "Last Super Admin protected" } } } },
      "/users/{id}/authorization": { patch: { summary: "Change roles and scopes with confirmation and immediate session revocation", responses: { "200": { description: "Authorization updated" }, "403": { description: "SUPER_ADMIN or valid reason required" }, "409": { description: "Last Super Admin protected" } } } },
      "/first-login/change-secret": { post: { summary: "Replace a temporary secret before CRM access", responses: { "201": { description: "Secret replaced and sessions revoked" }, "401": { description: "Authenticated session required" }, "403": { description: "Temporary credential or policy refused" } } } },
      "/access-recovery/requests": {
        post: {
          summary: "Request access recovery without account enumeration",
          responses: { "202": { description: "Generic recovery acknowledgement" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/access-recovery/completions": {
        post: {
          summary: "Consume a single-use local recovery challenge",
          responses: { "204": { description: "Challenge consumed" }, "400": { description: "Invalid input" }, "403": { description: "Invalid, expired or used challenge" } },
        },
      },
      "/leads/{leadId}/timeline": {
        get: { summary: "List immutable lead activities", responses: { "200": { description: "Reverse chronological timeline" }, "403": { description: "Role refused" }, "404": { description: "Lead not found" } } },
        post: { summary: "Append a lead activity", responses: { "201": { description: "Activity appended" }, "400": { description: "Invalid activity" }, "403": { description: "Role refused" } } },
      },
      "/leads/{leadId}/status": {
        patch: { summary: "Apply a controlled lead status transition", responses: { "200": { description: "Status changed and timeline event appended" }, "400": { description: "Transition or closure reason refused" }, "403": { description: "Role or closure approval refused" }, "404": { description: "Lead not found" } } },
      },
      "/leads": {
        post: { summary: "Create a normalized lead with an immutable identifier", description: "Accepts a client-stable idempotencyKey so an ambiguous network retry replays the first committed creation. Probable contact matches are reported without silently merging records.", responses: { "201": { description: "Lead created or idempotently replayed, with probable duplicate warnings" }, "400": { description: "Invalid, incomplete or malformed idempotency input" }, "403": { description: "Role or campus scope refused" }, "409": { description: "Idempotency key reused with different content" } } },
        get: { summary: "Search, filter, sort and paginate operational and saved provenance lead views", responses: { "200": { description: "Filtered leads with deterministic pagination, provenance views and role-based masking" }, "400": { description: "Invalid view, filter, sort or pagination" }, "403": { description: "Role refused" } } },
      },
      "/leads/{leadId}": {
        get: { summary: "Read one authorized lead", responses: { "200": { description: "Lead detail with role-based masking" }, "403": { description: "Role refused" }, "404": { description: "Lead not found" } } },
        patch: { summary: "Correct allowlisted current Lead fields without rewriting provenance or history", description: "Partial update with explicit empty contact clearing, server normalization, optimistic version and idempotency. Contact collisions are refused without identifying or merging the other Lead. The same contract serves the contextual drawer and direct page.", responses: { "200": { description: "Confirmed current Lead values" }, "400": { description: "Field, reference, email or phone invalid" }, "403": { description: "Effective lead.edit permission or campus scope refused" }, "409": { description: "Version, idempotency or contact collision" }, "404": { description: "Lead not found in the authorized scope" } } },
      },
      "/reports/manager-dashboard": { get: { summary: "Read the interactive aggregate dashboard with strictly normalized filters", responses: { "200": { description: "Versioned KPI, chart, navigation and drill-down aggregates" }, "400": { description: "Unknown or invalid filter" }, "403": { description: "Role or campus scope refused" } } } },
      "/reports/manager-dashboard/export": { get: { summary: "Export the same dashboard cohort as formula-safe aggregate CSV", responses: { "200": { description: "Versioned aggregate-only CSV without lead or collaborator identity" }, "400": { description: "Unknown or invalid filter" }, "403": { description: "Role or campus scope refused" } } } },
      "/reports/personal-dashboard": { get: { summary: "Read the authenticated adviser's own performance and authorized contributions", responses: { "200": { description: "Personal aggregate metrics without lead identity" }, "400": { description: "Unknown or invalid filter" }, "403": { description: "Another adviser or global view refused" } } } },
      "/leads/quick-entry/matches": { post: { summary: "Preview reliable email and phone matches before a call or visit entry", responses: { "201": { description: "Minimal candidate identifiers" }, "400": { description: "Identity required" }, "403": { description: "Role refused" } } } },
      "/leads/quick-entry": { post: { summary: "Create or attach a confirmed phone call or physical visit occurrence", responses: { "201": { description: "Created or existing lead with append-only evidence" }, "400": { description: "Invalid or incomplete input" }, "409": { description: "Contradictory identity collision" } } } },
      "/assignment/config": {
        get: { summary: "Read campus assignment rules and automaticEnabled", parameters: [{ name: "campusId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Versioned rules and persisted automaticEnabled, separate from Sheets connector activation" }, "403": { description: "Effective campus permission required" } } },
        put: { summary: "Replace assignment rules and automation state in one audited campus version", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["campusId", "expectedVersion", "rules"], properties: { campusId: { type: "string" }, expectedVersion: { type: "integer", minimum: 0 }, automaticEnabled: { type: "boolean", description: "False prevents automatic import assignment, not authorized FIXED manual assignment. Omission preserves previous state; legacy initial rules preserve enabled-rule semantics." }, rules: { type: "array", items: { type: "object" } } } } } } }, responses: { "200": { description: "Configuration and audit committed atomically" }, "400": { description: "Invalid configuration" }, "403": { description: "Effective settings.campus.manage required" }, "409": { description: "Version conflict" } } },
      },
      "/assignment/simulate": { post: { summary: "Simulate from the Lead's canonical campus and persisted rules without consuming a cursor", description: "Requires lead.assign. Client source/campaign values do not override the persisted Lead. Response includes mutated=false, targetUserId when available, configurationVersion and selection evidence or an explicit reason.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["leadId", "eventKey"], properties: { leadId: { type: "string", format: "uuid" }, eventKey: { type: "string" } } } } } }, responses: { "201": { description: "Read-only simulation; no Lead, cursor or success audit mutation" }, "403": { description: "Permission or campus refused" }, "404": { description: "Lead unavailable" }, "409": { description: "Ambiguous rule or no eligible candidate" } } } },
      "/assignment/auto": { post: { summary: "Record a decision and reserve one cursor position, without assigning the Lead", description: "Requires lead.assign in the Lead's canonical campus. Campaign > Source > campus fallback > UNASSIGNED. Decision, cursor and ASSIGNMENT_DECISION_CREATED audit commit atomically. Never writes the Lead or its timeline. Replaying the same eventKey for the same authorized Lead returns the original decision and rule version without consuming another cursor position; reuse for another Lead is refused. Effective assignment is performed by an authorized manual endpoint or server import execution; automatic imports do not require per-row human confirmation.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["leadId", "eventKey"], properties: { leadId: { type: "string", format: "uuid" }, eventKey: { type: "string", minLength: 8, maxLength: 128 } } } } } }, responses: { "201": { description: "Immutable decision including configurationVersion; no effective assignment" }, "403": { description: "Permission or campus refused without revealing a Lead" }, "409": { description: "Ambiguous/invalid rule, replay conflict or concurrent transaction; no partial cursor or audit" } } } },
      "/assignment/history": { get: { summary: "Read recorded campus assignment evidence without recomputation", parameters: [{ name: "campusId", in: "query", required: true, schema: { type: "string" } }, { name: "cursor", in: "query", required: false, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Campus rules (up to 100 revisions), recorded sanitized decisions (50 per page) and nextCursor; no reconstructed historical decisions" }, "403": { description: "Permission or campus refused" } } } },
      "/assignment/dashboard": { get: { summary: "Read Manager assignment KPIs and fail-closed alerts", description: "Persistent mode reads authorized campus configurations and recorded decision/assignment events. completedBatches and refusedByBatch are null with evidence.batchTotals=UNAVAILABLE_NOT_PERSISTED: historical volatile batch totals are not reconstructed or reported as zero. Capacity reports retain the existing maximum configured capacity per visible adviser.", responses: { "200": { description: "Sanitized assignment dashboard and explicit evidence availability" }, "403": { description: "Manager role and effective reporting.view required" } } } },
      "/leads/{leadId}/assignment": { post: { summary: "Assign one unassigned lead after explicit confirmation", responses: { "201": { description: "Lead assigned and timeline appended" }, "400": { description: "Confirmation required" }, "409": { description: "Lead already assigned; use reassignment workflow" } } } },
      "/leads/{leadId}/assignment-candidates": { get: { summary: "List eligible advisers for the Lead's canonical campus and applicable rule", description: "Returns business labels and current bounded capacity only. The assignment or reassignment mutation re-evaluates permissions, campus and eligibility.", responses: { "200": { description: "Eligible advisers visible to the current operation" }, "403": { description: "Effective assignment or reassignment permission required" }, "404": { description: "Lead unavailable in the current campus perimeter" } } } },
      "/lead-assignments/preview": { post: { summary: "Preview a bounded assignment batch without mutation", responses: { "201": { description: "Per-lead preview with mutated=false" }, "400": { description: "Invalid or unbounded batch" } } } },
      "/lead-assignments": { post: { summary: "Confirm an idempotent bounded assignment batch", responses: { "201": { description: "Assigned, skipped and refused results" }, "400": { description: "Confirmation or input invalid" } } } },
      "/leads/{leadId}/reassignment-requests": {
        post: { summary: "Request a controlled lead reassignment", responses: { "201": { description: "Pending request, ownership unchanged" }, "403": { description: "Current owner required" }, "409": { description: "Pending request already exists" } } },
        get: { summary: "List authorized reassignment history", responses: { "200": { description: "Append-only requests" }, "403": { description: "Ownership or Manager role required" } } },
      },
      "/reassignment-requests/{requestId}/decision": { patch: { summary: "Approve or reject a reassignment as Manager/Admin", responses: { "200": { description: "Decision recorded; ownership changes only on approval" }, "403": { description: "Role or separation of duties refused" }, "409": { description: "Owner changed or decision already recorded" } } } },
      "/lead-ingestion/batches": { post: { summary: "Run one confirmed, bounded and idempotent lead ingestion batch", responses: { "201": { description: "Sanitized created, attached, review and invalid counts" }, "400": { description: "Invalid batch or mapping" }, "403": { description: "Manager role required" } } } },
      "/lead-ingestion/leads/{leadId}/provenance": { get: { summary: "Read sanitized append-only provenance", responses: { "200": { description: "Provenance without external identifier value" }, "403": { description: "Manager role required" } } } },
      "/lead-import/profiles": { post: { summary: "Profile a bounded CSV or XLSX and return PII-free structural and legacy quality counts without importing rows", responses: { "201": { description: "Sanitized profile, cutover blockers and mutated=false" }, "400": { description: "File, encoding, formula, macro or mapping refused" }, "403": { description: "Manager role required" } } } },
      "/lead-import/mappings": {
        get: { summary: "List latest reusable import mapping versions without business data", responses: { "200": { description: "Built-in and custom mapping metadata" }, "403": { description: "Manager role required" } } },
        post: { summary: "Create an immutable import mapping version with optimistic concurrency", responses: { "201": { description: "Versioned mapping metadata" }, "400": { description: "Invalid, ambiguous or incomplete mapping" }, "409": { description: "Version conflict or built-in mapping" } } },
      },
      "/lead-import/dry-runs": { post: { summary: "Normalize, deduplicate and preview assignment without business mutation", responses: { "201": { description: "Sanitized reconciled counts with mutated=false" }, "400": { description: "Columns, cells or mapping refused" }, "403": { description: "Manager role required" }, "404": { description: "Mapping version not found" } } } },
      "/lead-import/reports": { post: { summary: "Create an immutable reconciliation report for an ingestion job", responses: { "201": { description: "Sanitized and reconciled report" }, "400": { description: "Invalid hash or identity" }, "404": { description: "Batch or mapping not found" }, "409": { description: "Conflicting report replay" } } } },
      "/lead-import/reports/{jobId}": { get: { summary: "Read one authorized import reconciliation report", responses: { "200": { description: "Sanitized report without lead identity" }, "404": { description: "Report not found" } } } },
      "/lead-import/reports/{jobId}/rejections": { get: { summary: "Export rejected line numbers and stable reason codes as CSV", responses: { "200": { description: "PII-free CSV export" }, "404": { description: "Report not found" } } } },
      "/lead-import/wizards": { post: { summary: "Start a code-only CSV/XLSX import wizard without retaining raw content", responses: { "201": { description: "Sanitized wizard session" }, "400": { description: "Unsafe envelope refused" } } } },
      "/lead-import/wizards/{id}/reconcile": { post: { summary: "Reconcile profile, mapping, quality, collision, assignment and dry-run evidence", responses: { "201": { description: "Explicit confirmation unlocked" }, "409": { description: "Evidence incomplete" } } } },
      "/lead-import/wizards/{id}/confirm": { post: { summary: "Confirm a fully reconciled code-only wizard", responses: { "201": { description: "Report step reached without business mutation" }, "409": { description: "Confirmation refused" } } } },
      "/lead-import/wizards/{id}": { get: { summary: "Read a sanitized wizard session", responses: { "200": { description: "Wizard state" }, "404": { description: "Session not found" } } } },
      "/lead-import/reviews": { get: { summary: "List sanitized import collisions requiring a controlled decision", responses: { "200": { description: "Review queue" } } }, post: { summary: "Queue a sanitized collision without raw values", responses: { "201": { description: "Review item" }, "400": { description: "Unsafe evidence refused" } } } },
      "/lead-import/reviews/{id}/decisions": { post: { summary: "Record an idempotent create, attach or ignore decision", responses: { "201": { description: "Versioned decision" }, "403": { description: "Target outside allowed candidates" }, "409": { description: "Stale or conflicting decision" } } } },
      "/integrations/forminator/v1/leads": { post: { summary: "Validate a versioned HMAC-signed Forminator/Zapier lead event without activating ingestion", parameters: [
        { name: "x-forminator-timestamp", in: "header", required: true, schema: { type: "string", example: "1787500000" } },
        { name: "x-forminator-signature", in: "header", required: true, schema: { type: "string", example: "sha256=0000000000000000000000000000000000000000000000000000000000000000" } },
        { name: "x-idempotency-key", in: "header", required: true, schema: { type: "string", example: "synthetic-event-0001" } }],
        requestBody: { required: true, content: { "application/json": { example: { schemaVersion: "1", eventId: "synthetic-event-0001", occurredAt: "2026-08-23T12:00:00Z",
          lead: { firstName: "Prénom synthétique", lastName: "Nom synthétique", email: "lead@example.invalid", educationLevel: "BAC", program: "Programme synthétique" } } } } },
        responses: { "201": { description: "Signature accepted; mutated=false until CRMY-65" }, "400": { description: "Headers, schema or allowlist refused" },
          "401": { description: "Signature or timestamp refused" }, "409": { description: "Idempotency conflict" }, "429": { description: "Rate limit exceeded" }, "503": { description: "Adapter disabled or secret absent" } } } },
    },
  } as const;
  app.use("/docs", serve, setup(openApi));
  app.getHttpAdapter().get("/docs-json", (_request: unknown, response: { json: (body: unknown) => void }) => response.json(openApi));
}
