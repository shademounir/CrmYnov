import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("DEV Web uses the approved public origin rather than a client-supplied Host", () => {
  const runtime = read("infra/environments/dev/main.tf");
  const web = runtime.slice(runtime.indexOf('resource "google_cloud_run_v2_service" "web"'));
  assert.match(web, /name\s*=\s*"CRM_PUBLIC_ORIGIN"\s+value\s*=\s*var\.crm_public_origin/u);
  assert.match(read("infra/environments/dev/variables.tf"), /var\.crm_public_origin\s*==\s*"https:\/\/crm-dev-web-bvzn3lz52q-ew\.a\.run\.app"/u);
});

test("local Compose requires an explicit public origin and synthetic example matches its public Web port", () => {
  assert.match(read("compose.yaml"), /CRM_PUBLIC_ORIGIN:\s*\$\{CRM_PUBLIC_ORIGIN:\?CRM_PUBLIC_ORIGIN is required\}/u);
  const example = read(".env.example");
  const port = /^WEB_PORT=(\d+)$/mu.exec(example)?.[1];
  assert.ok(port);
  assert.match(example, new RegExp(`^CRM_PUBLIC_ORIGIN=http://localhost:${port}$`, "mu"));
});

test("isolated Playwright Web explicitly configures its browser origin", () => {
  const config = read("apps/web/playwright.config.ts");
  assert.match(config, /env:\s*\{\s*CRM_PUBLIC_ORIGIN:\s*"http:\/\/localhost:3000",\s*CRM_API_INTERNAL_URL:\s*"http:\/\/127\.0\.0\.1:1"\s*\}/u);
});
