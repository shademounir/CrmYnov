import { expect, test } from "@playwright/test";

const pages = [
  ["/about", "CRM Ynov — Admissions et suivi commercial"],
  ["/privacy", "Confidentialité du CRM Ynov"],
  ["/terms", "Conditions d’utilisation interne"],
] as const;

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`public information is anonymous, interlinked and contained at ${width}px`, async ({ page, context }) => {
    const apiCalls: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
    // A pending first login must not prevent reading the public notices.
    await context.addCookies([{ name: "crm_first_login", value: "required", url: "http://localhost:3000" }]);
    await page.setViewportSize({ width, height: 950 });
    for (const [path, heading] of pages) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(".sidebar")).toHaveCount(0);
      for (const [href] of pages) await expect(page.getByRole("navigation").locator(`a[href="${href}"]`)).toBeVisible();
      await expect(page.getByRole("link", { name: "Connexion sécurisée" })).toHaveAttribute("href", "/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(apiCalls).toEqual([]);
  });
}

test("public notices remain available without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const [path, heading] of pages) {
      expect((await page.goto(`http://localhost:3000${path}`))?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  } finally { await context.close(); }
});
