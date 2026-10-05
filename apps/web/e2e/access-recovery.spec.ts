import { expect, test, type Page, type TestInfo } from "@playwright/test";

// Real Next pages, styles and keyboard interactions. API responses below are
// controlled browser mocks: no identity mutation, PostgreSQL or Gmail delivery.
const widths = [1440, 1280, 1024, 768, 390];
const token = "A".repeat(43);
const syntheticSecret = "Synthetic-Password-2026!";

async function captureContainedCard(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; });
  const card = page.locator(".login-card");
  await expect(card).toBeVisible();
  const outside = await card.locator("input,button,a").evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 1 || rect.height < 1;
  }).map((element) => element.getAttribute("name") ?? element.textContent));
  expect(outside).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

for (const width of widths) {
  test(`recovery request is labelled and keyboard usable at ${width}px with a simulated acknowledgement`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests: Array<{ email: string; returnPath: string }> = [];
    let releaseResponse: (() => void) | undefined;
    const heldResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route("**/api/crm/**", async (route) => {
      expect(new URL(route.request().url()).pathname).toBe("/api/crm/access-recovery/requests");
      expect(route.request().method()).toBe("POST");
      requests.push(route.request().postDataJSON() as { email: string; returnPath: string });
      await heldResponse;
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/access-recovery");
    const card = page.locator(".login-card");
    await expect(page.getByRole("heading", { name: "Récupérer mon accès", exact: true })).toBeVisible();
    const form = page.getByRole("form", { name: "Demander la récupération de mon accès" });
    await expect(form).toHaveAttribute("method", "post");
    await expect(page.locator(".sidebar")).toHaveCount(0);
    const email = page.getByRole("textbox", { name: "Adresse professionnelle", exact: true });
    await expect(email).toHaveAttribute("type", "email");
    await email.focus();
    await page.keyboard.insertText("recovery-browser@example.invalid");
    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Demander la récupération", exact: true });
    await expect(submit).toBeFocused();
    await captureContainedCard(page, testInfo, `recovery-request-${width}px`);
    await page.keyboard.press("Enter");
    await expect.poll(() => requests.length).toBe(1);
    await expect(email).toBeDisabled();
    await expect(page.getByRole("button", { name: "Demande en cours…", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(requests).toEqual([{ email: "recovery-browser@example.invalid", returnPath: "/access-recovery/complete" }]);
    releaseResponse?.();
    await expect(card.getByRole("status")).toContainText("La réception du message n’est pas confirmée.");
    await expect(email).toBeEnabled();
    const back = page.getByRole("link", { name: "Revenir à la connexion", exact: true });
    await submit.focus(); await page.keyboard.press("Tab"); await expect(back).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(submit).toBeFocused();
    await captureContainedCard(page, testInfo, `recovery-request-acknowledged-${width}px`);
    expect(errors).toEqual([]);
  });

  test(`recovery completion removes its fragment and is keyboard usable at ${width}px with a simulated 204`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: Array<{ token: string; returnPath: string; nextSecret: string }> = [];
    const documentUrls: string[] = [];
    page.on("request", (request) => { if (request.resourceType() === "document") documentUrls.push(request.url()); });
    let releaseResponse: (() => void) | undefined;
    const heldResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route("**/api/crm/**", async (route) => {
      expect(new URL(route.request().url()).pathname).toBe("/api/crm/access-recovery/completions");
      expect(route.request().method()).toBe("POST");
      writes.push(route.request().postDataJSON() as { token: string; returnPath: string; nextSecret: string });
      await heldResponse;
      await route.fulfill({ status: 204, body: "" });
    });
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(`/access-recovery/complete#token=${token}`);
    expect(response).not.toBeNull();
    const serverHtml = await response!.text();
    expect(serverHtml).not.toContain(token);
    expect(serverHtml).not.toMatch(/<input[^>]+name="(?:nextSecret|confirmation|token)"/u);
    await expect(page).toHaveURL(/\/access-recovery\/complete$/u);
    expect(documentUrls.every((url) => !url.includes(token) && !url.includes("token="))).toBe(true);
    await expect(page.getByRole("heading", { name: "Définir un nouveau mot de passe", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    const form = page.getByRole("form", { name: "Définir mon nouveau mot de passe" });
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.locator('[name="token"]')).toHaveCount(0);
    const secret = page.getByLabel("Nouveau mot de passe", { exact: true });
    const confirmation = page.getByLabel("Confirmer le mot de passe", { exact: true });
    for (const field of [secret, confirmation]) {
      await expect(field).toHaveAttribute("type", "password");
      await expect(field).toHaveAttribute("minlength", "14");
      await expect(field).toHaveAttribute("maxlength", "128");
    }
    await secret.focus(); await page.keyboard.insertText(syntheticSecret);
    await page.keyboard.press("Tab"); await expect(confirmation).toBeFocused();
    await page.keyboard.insertText(syntheticSecret);
    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Enregistrer le mot de passe", exact: true });
    await expect(submit).toBeFocused();
    await captureContainedCard(page, testInfo, `recovery-completion-${width}px`);
    await page.keyboard.press("Enter");
    await expect.poll(() => writes.length).toBe(1);
    await expect(secret).toBeDisabled(); await expect(confirmation).toBeDisabled();
    await expect(page.getByRole("button", { name: "Enregistrement…", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(writes).toEqual([{ token, returnPath: "/access-recovery/complete", nextSecret: syntheticSecret }]);
    releaseResponse?.();
    await expect(page.locator(".login-card").getByRole("status")).toContainText("Mot de passe enregistré.");
    await expect(form).toHaveCount(0);
    await expect(page).toHaveURL(/\/access-recovery\/complete$/u);
    const login = page.getByRole("link", { name: "Se connecter", exact: true });
    await login.focus(); await expect(login).toBeFocused();
    await captureContainedCard(page, testInfo, `recovery-completion-simulated-success-${width}px`);
    expect(errors).toEqual([]);
  });
}
