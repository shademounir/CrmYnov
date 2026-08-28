import { defineConfig, devices } from "@playwright/test";

const localPersistentStack = process.env.CRM_LOCAL_E2E === "true";

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "test/e2e/**/*.test.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: { baseURL: process.env.CRM_LOCAL_WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  ...(localPersistentStack ? {} : { webServer: { command: "npm run dev --workspace=@crm/web", url: "http://localhost:3000/manager/reports/dashboard", timeout: 120_000, reuseExistingServer: false, cwd: "../.." } }),
});
