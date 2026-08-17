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
    },
  } as const;
  app.use("/docs", serve, setup(openApi));
  app.getHttpAdapter().get("/docs-json", (_request: unknown, response: { json: (body: unknown) => void }) => response.json(openApi));
  return app;
}
