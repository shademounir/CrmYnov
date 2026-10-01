import "reflect-metadata";
import { Module, type INestApplication, type Provider, type Type } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module.js";
import { configureApplication } from "../../src/application.js";
import { DefaultGrantProvider, GrantProvider } from "../../src/permissions/permission.service.js";

/**
 * Explicit adapter for historical in-memory business-contract tests only.
 * This is NOT evidence for CRMY-169, whose separate PostgreSQL/HTTP tests use
 * the production AppModule with its mandatory fail-closed interceptor.
 * No environment flag or alternate provider exists in the production bootstrap.
 */
const sourceProviders = Reflect.getMetadata("providers", AppModule) as Provider[];
const providers = sourceProviders.filter((provider) => !(typeof provider === "object" && provider !== null && "provide" in provider && [APP_INTERCEPTOR, GrantProvider].includes(provider.provide as typeof GrantProvider)))
  .concat({ provide: GrantProvider, useClass: DefaultGrantProvider });
@Module({ controllers: Reflect.getMetadata("controllers", AppModule) as Type<unknown>[], providers })
class SyntheticBusinessContractModule {}
export async function createApplication(): Promise<INestApplication> {
  if (process.env.DATABASE_URL) throw new Error("synthetic_contract_harness_must_not_use_database");
  const app = await NestFactory.create(SyntheticBusinessContractModule, { logger: ["error"] });
  configureApplication(app);
  return app;
}
