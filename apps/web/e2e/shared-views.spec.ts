import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`shared views: confirmation, bounded links and accessible cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let shares = 0;
    const own = { id: "00000000-0000-4000-8000-000000000170", name: "Vue synthétique privée", filters: { status: "PROSPECT" }, version: 1,
      ownerDisplayName: "Utilisateur synthétique", isOwner: true, visibleAudiences: [], canEdit: true, canRevoke: false, canDuplicate: true };
    const received = { ...own, id: "00000000-0000-4000-8000-000000000171", name: "Vue synthétique reçue", isOwner: false, canEdit: false,
      ownerDisplayName: "Responsable synthétique", visibleAudiences: [{ type: "TEAM", label: "Équipe synthétique" }, { type: "CAMPUS", label: "Campus synthétique" }] };
    const campus = "00000000-0000-4000-8000-000000000172";
    await page.route("**/api/crm/**", async (route) => {
      const url = new URL(route.request().url());
      let body: object = {};
      if (url.pathname === "/api/crm/lead-views") body = [own];
      if (url.pathname === `/api/crm/view-sharing/views/${own.id}`) body = own;
      if (url.pathname.endsWith("/received")) body = [received];
      if (url.pathname.endsWith("/audiences")) body = [{ id: campus, campusId: campus, label: "Campus synthétique", kind: "CAMPUS" }];
      if (url.pathname.endsWith("/history")) body = [];
      if (url.pathname.endsWith("/shares")) {
        shares++;
        expect(route.request().postDataJSON()).toEqual({ expectedVersion: 1, idempotencyKey: expect.any(String), kind: "CAMPUS", audienceId: campus });
        body = { ...own, version: 2 };
      }
      await route.fulfill({ status: route.request().method() === "POST" ? 201 : 200, json: body });
    });
    await page.goto("/leads");
    const panel = page.getByRole("region", { name: "Partage des vues", exact: true });
    await expect(panel.getByText("Vue synthétique reçue", { exact: true })).toBeVisible();
    const receivedCard = panel.getByRole("article", { name: received.name });
    await expect(receivedCard.getByText("Partagée par Responsable synthétique", { exact: true })).toBeVisible();
    await expect(receivedCard.locator(".shared-view-badge")).toHaveText(["Équipe", "Campus"]);
    await expect(receivedCard.getByText("Version 1 · Définition en lecture seule", { exact: true })).toBeVisible();
    await expect(receivedCard.getByRole("button", { name: /Modifier|Révoquer/ })).toHaveCount(0);
    await expect(panel.locator("table")).toHaveCount(0);
    await panel.getByLabel("Ma vue originale").selectOption(own.id);
    await panel.getByLabel("Destinataire autorisé").selectOption(campus);
    await panel.getByRole("button", { name: "Partager la vue", exact: true }).click();
    expect(shares).toBe(0);
    await expect(panel.getByRole("heading", { name: "Confirmation requise" })).toBeVisible();
    await panel.getByRole("button", { name: "Confirmer l’action", exact: true }).click();
    await expect.poll(() => shares).toBe(1);
    await expect(panel.getByText("Action enregistrée.", { exact: false })).toBeVisible();
    const open = panel.getByRole("link", { name: "Ouvrir la vue Vue synthétique reçue" });
    await expect(open).toHaveAttribute("href", `/leads?sharedViewId=${received.id}&page=1`);
    await open.focus(); await expect(open).toBeFocused();
    const button = panel.getByRole("button", { name: "Actualiser les partages", exact: true });
    const bounds = await button.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44);
    const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth + 1); expect(overflow).toBe(false);
  });
}
