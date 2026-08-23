import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { setup, serve } from "swagger-ui-express";
import { AppModule } from "./app.module.js";
import { correlationMiddleware } from "./correlation.middleware.js";
import { authenticationMiddleware } from "./auth/auth.middleware.js";
import { SessionService } from "./auth/session.service.js";

export async function createApplication(logLevel: "error" | "warn" | "log" = "error"): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: [logLevel] });
  app.use(correlationMiddleware);
  app.use(authenticationMiddleware(app.get(SessionService)));
  app.enableCors({ origin: "http://localhost:3000", methods: ["GET", "POST", "DELETE", "PATCH"] });
  app.enableShutdownHooks();
  const openApi = {
    openapi: "3.0.3",
    info: { title: "CRM Admissions API", version: "0.1.0" },
    paths: {
      "/health": {
        get: {
          summary: "API operational health",
          responses: { "200": { description: "Service is healthy" } },
        },
      },
      "/sessions": { post: { summary: "Create a short-lived application session", responses: { "201": { description: "Session created" }, "429": { description: "Rate limit exceeded" } } } },
      "/sessions/{sessionId}": { delete: { summary: "Revoke a session", responses: { "200": { description: "Revocation result" }, "403": { description: "Ownership required" } } } },
      "/sessions/users/{userId}/revoke": { post: { summary: "Revoke every active session for a user", responses: { "201": { description: "Sessions revoked" }, "403": { description: "SUPER_ADMIN required" } } } },
      "/resources/{resourceId}": { patch: { summary: "Update a resource within the caller ownership and scope", responses: { "200": { description: "Resource updated" }, "403": { description: "Resource unavailable" } } } },
      "/audit-events": { get: { summary: "List the append-only audit trail", responses: { "200": { description: "Sanitized audit events" }, "403": { description: "AUDITOR or SUPER_ADMIN required" } } } },
      "/users": { get: { summary: "Filter collaborators", responses: { "200": { description: "Collaborators" }, "403": { description: "SUPER_ADMIN required" } } }, post: { summary: "Create a collaborator", responses: { "201": { description: "Collaborator created" }, "403": { description: "SUPER_ADMIN required" } } } },
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
        post: { summary: "Create a normalized lead with an immutable identifier", responses: { "201": { description: "Lead created with probable duplicate warnings" }, "400": { description: "Invalid or incomplete input" }, "403": { description: "Role refused" } } },
        get: { summary: "Search, filter, sort and paginate ALL, MINE, FOLLOW_UP, UNASSIGNED, NO_ACTIVITY or CLOSED lead views", responses: { "200": { description: "Filtered leads with deterministic pagination, due-date ordering and role-based masking" }, "400": { description: "Invalid view, filter, sort or pagination" }, "403": { description: "Role refused" } } },
      },
      "/leads/{leadId}": { get: { summary: "Read one authorized lead", responses: { "200": { description: "Lead detail with role-based masking" }, "403": { description: "Role refused" }, "404": { description: "Lead not found" } } } },
      "/assignment/config": {
        get: { summary: "Read assignment rules", responses: { "200": { description: "Versioned rules" }, "403": { description: "Manager role required" } } },
        put: { summary: "Replace assignment rules with an audited configuration", responses: { "200": { description: "Configuration accepted" }, "400": { description: "Invalid configuration" }, "403": { description: "Manager role required" } } },
      },
      "/assignment/simulate": { post: { summary: "Simulate an assignment without mutation", responses: { "201": { description: "Deterministic candidate selection with mutated=false" }, "409": { description: "Ambiguous rule or no eligible candidate" } } } },
      "/assignment/auto": { post: { summary: "Create one idempotent automatic assignment decision", responses: { "201": { description: "Assignment decision" }, "409": { description: "Ambiguous rule or no eligible candidate" } } } },
      "/assignment/history": { get: { summary: "Read immutable assignment configuration and decision evidence", responses: { "200": { description: "Sanitized history" }, "403": { description: "Manager role required" } } } },
      "/assignment/dashboard": { get: { summary: "Read Manager assignment KPIs and fail-closed alerts", responses: { "200": { description: "Sanitized assignment dashboard" }, "403": { description: "Manager role required" } } } },
      "/leads/{leadId}/assignment": { post: { summary: "Assign one unassigned lead after explicit confirmation", responses: { "201": { description: "Lead assigned and timeline appended" }, "400": { description: "Confirmation required" }, "409": { description: "Lead already assigned; use reassignment workflow" } } } },
      "/lead-assignments/preview": { post: { summary: "Preview a bounded assignment batch without mutation", responses: { "201": { description: "Per-lead preview with mutated=false" }, "400": { description: "Invalid or unbounded batch" } } } },
      "/lead-assignments": { post: { summary: "Confirm an idempotent bounded assignment batch", responses: { "201": { description: "Assigned, skipped and refused results" }, "400": { description: "Confirmation or input invalid" } } } },
      "/leads/{leadId}/reassignment-requests": {
        post: { summary: "Request a controlled lead reassignment", responses: { "201": { description: "Pending request, ownership unchanged" }, "403": { description: "Current owner required" }, "409": { description: "Pending request already exists" } } },
        get: { summary: "List authorized reassignment history", responses: { "200": { description: "Append-only requests" }, "403": { description: "Ownership or Manager role required" } } },
      },
      "/reassignment-requests/{requestId}/decision": { patch: { summary: "Approve or reject a reassignment as Manager/Admin", responses: { "200": { description: "Decision recorded; ownership changes only on approval" }, "403": { description: "Role or separation of duties refused" }, "409": { description: "Owner changed or decision already recorded" } } } },
      "/lead-ingestion/batches": { post: { summary: "Run one confirmed, bounded and idempotent lead ingestion batch", responses: { "201": { description: "Sanitized created, attached, review and invalid counts" }, "400": { description: "Invalid batch or mapping" }, "403": { description: "Manager role required" } } } },
      "/lead-ingestion/leads/{leadId}/provenance": { get: { summary: "Read sanitized append-only provenance", responses: { "200": { description: "Provenance without external identifier value" }, "403": { description: "Manager role required" } } } },
    },
  } as const;
  app.use("/docs", serve, setup(openApi));
  app.getHttpAdapter().get("/docs-json", (_request: unknown, response: { json: (body: unknown) => void }) => response.json(openApi));
  return app;
}
