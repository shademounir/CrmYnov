import assert from "node:assert/strict";
import test from "node:test";
import { loadEnvironment } from "../src/environment.js";

test("accepts a complete synthetic environment", () => {
  assert.deepEqual(loadEnvironment({ DATABASE_URL: "postgresql://crm:synthetic@localhost:5432/crm", API_PORT: "3001", LOG_LEVEL: "warn" }), {
    databaseUrl: "postgresql://crm:synthetic@localhost:5432/crm", port: 3001, logLevel: "warn",
  });
});

test("fails closed without PostgreSQL configuration or with invalid values", () => {
  assert.throws(() => loadEnvironment({}), /DATABASE_URL/);
  assert.throws(() => loadEnvironment({ DATABASE_URL: "mysql://localhost/db" }), /PostgreSQL/);
  assert.throws(() => loadEnvironment({ DATABASE_URL: "postgresql://localhost/db", API_PORT: "0" }), /API_PORT/);
  assert.throws(() => loadEnvironment({ DATABASE_URL: "postgresql://localhost/db", LOG_LEVEL: "debug" }), /LOG_LEVEL/);
});
