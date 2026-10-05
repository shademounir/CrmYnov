import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const variablesUrl = new URL("../environments/dev/variables.tf", import.meta.url);
const mainUrl = new URL("../environments/dev/main.tf", import.meta.url);

test("DEV access recovery requires an explicit boolean opt-in and defaults off", async () => {
  const variables = await readFile(variablesUrl, "utf8");
  const declaration = variables.match(/^variable "access_recovery_enabled" \{[\s\S]*?^\}/mu)?.[0];
  assert.ok(declaration, "missing explicit recovery activation variable");
  assert.match(declaration, /\btype\s*=\s*bool\b/u);
  assert.match(declaration, /\bdefault\s*=\s*false\b/u);
  assert.doesNotMatch(declaration, /gmail_invitation_enabled|secret_key_ref/u);
});

test("only the DEV API receives the string boolean recovery flag, never Web or jobs", async () => {
  const main = await readFile(mainUrl, "utf8");
  const api = main.split(/(?=^resource )/mu).find((block) => block.startsWith('resource "google_cloud_run_v2_service" "api" {'));
  assert.ok(api, "missing API service");
  assert.match(api, /env\s*\{\s*name\s*=\s*"CRM_ACCESS_RECOVERY_ENABLED"\s*value\s*=\s*tostring\(var\.access_recovery_enabled\)\s*\}/u);
  assert.equal(main.match(/CRM_ACCESS_RECOVERY_ENABLED/gu)?.length, 1, "activation must not propagate to other resources");
  assert.equal(main.match(/var\.access_recovery_enabled/gu)?.length, 1, "activation is independent of Gmail and service/job provisioning");
});
