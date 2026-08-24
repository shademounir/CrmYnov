import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run dev --workspace=@crm/web", url: "http://localhost:3000/manager/reports/dashboard", timeout: 120_000, reuseExistingServer: false, cwd: "../.." },
});
