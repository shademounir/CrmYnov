import assert from "node:assert/strict";
import test from "node:test";
import { health } from "../src/index.ts";

test("health returns the shared health contract", () => {
  const result = health("api", new Date("2026-01-01T00:00:00.000Z"));
  assert.deepEqual(result, { status: "ok", service: "api", timestamp: "2026-01-01T00:00:00.000Z" });
});
