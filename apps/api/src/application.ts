import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { setup, serve } from "swagger-ui-express";
import { AppModule } from "./app.module.js";
import { correlationMiddleware } from "./correlation.middleware.js";

export async function createApplication(logLevel: "error" | "warn" | "log" = "error"): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: [logLevel] });
  app.use(correlationMiddleware);
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
    },
  } as const;
  app.use("/docs", serve, setup(openApi));
  app.getHttpAdapter().get("/docs-json", (_request: unknown, response: { json: (body: unknown) => void }) => response.json(openApi));
  return app;
}
