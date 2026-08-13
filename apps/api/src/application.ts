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
    },
  } as const;
  app.use("/docs", serve, setup(openApi));
  app.getHttpAdapter().get("/docs-json", (_request: unknown, response: { json: (body: unknown) => void }) => response.json(openApi));
  return app;
}
