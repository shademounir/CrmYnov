import { test, expect, type Page } from "@playwright/test";

async function mockRoleShell(page: Page): Promise<void> {
  // Every API request is intercepted; these synthetic browser fixtures never
  // authenticate a real account or persist real grants.
  await page.route("**/api/crm/**", (route) => route.fulfill({ status: 503, json: { code: "synthetic_endpoint_unavailable" } }));
  await page.route("**/api/crm/sessions/current", (route) => route.fulfill({ json: { roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], professionalEmail: "synthetic-admin@example.invalid", mustChangeSecret: false } }));
  await page.route("**/api/crm/reports/dashboard/capabilities", (route) => route.fulfill({ json: { canViewPersonalDashboard: true, canViewPilotageDashboard: false } }));
  await page.route("**/api/crm/telephony/me", (route) => route.fulfill({ json: { global: { enabled: false, mode: "DISABLED" }, profile: null, workstation: null, readiness: { available: false, reason: "MODE_DISABLED" }, canPair: false, canRevoke: false, localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false } }));
  await page.route("**/api/crm/admissions/context", (route) => route.fulfill({ json: { timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: false, campuses: [], eligibleUsers: [] } }));
  await page.route("**/api/crm/notifications?*", (route) => route.fulfill({ json: { items: [], unread: 0, total: 0, page: 1, pageSize: 1 } }));
  await page.route("**/api/crm/leads?*", (route) => route.fulfill({ json: { items: [], page: 1, pageSize: 100, total: 0 } }));
}

test("CRMY-169 responsive role editor: preview, cancel, save, conflict, history and immutable reader", async ({ page }) => {
  await mockRoleShell(page);
  const roles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"].map((role) => ({ role, label: role === "AUDITOR" ? "Lecteur" : role, users: 2, editable: true }));
  const catalogue = [
    { key: "lead.view", module: "lead", mutation: false, sensitive: false, reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] },
    { key: "lead.edit", module: "lead", mutation: true, sensitive: true, reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] },
    { key: "reporting.pilotage.view", module: "reporting", mutation: false, sensitive: false, reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] },
  ];
  let version = 0, writes = 0, conflict = false;
  await page.route("**/api/crm/admin/role-permissions/**", async (route) => {
    const url = new URL(route.request().url()), endpoint = url.pathname.split("/").at(-1);
    const isWrite = route.request().method() === "POST";
    if (endpoint === "catalogue") return route.fulfill({ json: { catalogueVersion: 4, campus: "GLOBAL", catalogue, roles, campuses: [], global: true } });
    if (endpoint === "configuration" && !isWrite) return route.fulfill({ json: { kind: "ROLE", role: url.searchParams.get("role"), campus: "GLOBAL", version, inherited: version === 0, grants: { "lead.view": "CAMPUS", "lead.edit": url.searchParams.get("role") === "AUDITOR" ? "NONE" : "CAMPUS", "reporting.pilotage.view": "NONE" }, globalCeiling: { "lead.view": "GLOBAL", "lead.edit": "GLOBAL", "reporting.pilotage.view": "GLOBAL" } } });
    if (endpoint === "history") return route.fulfill({ json: { versions: version ? [{ number: version, createdAt: "2026-09-02T12:00:00Z", audits: [{ actorId: "synthetic-admin-id", actorRoles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", createdAt: "2026-09-02T12:00:00Z" }] }] : [] } });
    if (endpoint === "preview") return route.fulfill({ json: { expectedVersion: version, affectedUsers: 2, mutated: false, changes: [{ permission: "lead.edit", from: "CAMPUS", to: "NONE", widening: false, sensitive: true }] } });
    if (endpoint === "configuration" && isWrite) {
      if (conflict) return route.fulfill({ status: 409, json: { code: "permission_version_conflict" } });
      writes++; version++; return route.fulfill({ status: 201, json: { version } });
    }
    if (endpoint === "restore") { writes++; version++; return route.fulfill({ status: 201, json: { version } }); }
    if (endpoint === "effective") return route.fulfill({ json: { businessRules: "Validation Manager obligatoire.", permissions: [{ permission: "lead.edit", allowed: true, restriction: null, sources: [{ role: "MANAGER", sourceScope: "CAMPUS", globalCeiling: "GLOBAL", campusCeiling: "CAMPUS", campusGrant: "CAMPUS", allowed: true, restriction: null }] }] } });
    return route.fulfill({ status: 403, json: { code: "permission_denied" } });
  });
  await page.goto("/admin/roles");
  await expect(page.getByRole("heading", { name: "Rôles et permissions", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Configuration ciblée", exact: true })).toContainText("registre v4");
  await expect(page.getByRole("region", { name: "Mes droits actuellement enregistrés", exact: true })).toContainText("pas le rôle sélectionné ni son brouillon");
  await expect(page.getByRole("region", { name: "Un accès dédié au tableau de bord", exact: true })).toContainText("n’accorde aucun droit d’administration");
  const toggle = page.getByRole("region", { name: "Configurer les permissions", exact: true }).getByRole("switch", { name: "Activer cette capacité : Corriger les informations d’un Lead", exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await expect(page.getByRole("region", { name: "Vérifier avant d’appliquer", exact: true })).toContainText("Brouillon non enregistré");
  await expect(page.getByRole("heading", { name: "Aperçu avant enregistrement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle version" })).toBeDisabled();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(writes).toBe(0); await expect(toggle).toBeChecked();
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await page.getByRole("checkbox", { name: "Je confirme les modifications et leurs conséquences sur les accès." }).check();
  await page.getByRole("button", { name: "Enregistrer la nouvelle version" }).click();
  await page.locator("details.permission-history > summary").click();
  await expect(page.getByRole("button", { name: "Restaurer la version 1" })).toBeVisible(); expect(writes).toBe(1);
  await page.getByRole("button", { name: "Expliquer mes droits dans ce contexte" }).click();
  await expect(page.getByRole("heading", { name: "Mes droits effectifs" })).toBeVisible();
  await page.getByRole("button", { name: "Restaurer la version 1" }).click();
  await expect(page.getByRole("heading", { name: "Confirmer la restauration de v1 ?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmer la restauration", exact: true }).click();
  await page.locator("details.permission-history > summary").click();
  await expect(page.getByRole("button", { name: "Restaurer la version 2" })).toBeVisible(); expect(writes).toBe(2);
  conflict = true;
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await page.getByRole("checkbox", { name: "Je confirme les modifications et leurs conséquences sur les accès." }).check();
  await page.getByRole("button", { name: "Enregistrer la nouvelle version" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Conflit de version" })).toBeVisible(); expect(writes).toBe(2);
  await page.getByRole("combobox", { name: "Rôle système", exact: true }).selectOption("AUDITOR");
  await expect(toggle).toBeDisabled(); await expect(toggle).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".permission-notice")).toHaveText("Lecteur : les permissions de mutation sont structurellement non attribuables.");
  const size = await toggle.boundingBox(); expect(size?.width).toBeGreaterThanOrEqual(44); expect(size?.height).toBeGreaterThanOrEqual(44);
  await page.getByLabel("Rechercher une capacité", { exact: true }).fill("unknown-permission");
  await expect(page.getByText("Aucune permission correspondant à la recherche.")).toBeVisible();
});

test("CRMY-169 unavailable authorization service never renders permissive defaults", async ({ page }) => {
  await mockRoleShell(page);
  await page.route("**/api/crm/admin/role-permissions/**", (route) => route.fulfill({ status: 503, json: { code: "permission_store_unavailable" } }));
  await page.goto("/admin/roles");
  await expect(page.getByRole("alert").filter({ hasText: "Aucun droit de secours" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle version" })).toHaveCount(0);
});

test("CRMY-178 role context, grouped rows and review remain keyboard-accessible at five widths", async ({ page }) => {
  await mockRoleShell(page);
  await page.route("**/api/crm/admin/role-permissions/**", (route) => {
    const url = new URL(route.request().url()), endpoint = url.pathname.split("/").at(-1);
    expect(route.request().method()).toBe("GET");
    const scopes = ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"];
    if (endpoint === "catalogue") return route.fulfill({ json: { campus: "GLOBAL", catalogueVersion: 4, catalogue: [
      { key: "lead.view", module: "lead", mutation: false, sensitive: false, reserved: false, scopes },
      { key: "reporting.pilotage.view", module: "reporting", mutation: false, sensitive: false, reserved: false, scopes },
      { key: "reporting.global.view", module: "reporting", mutation: false, sensitive: false, reserved: true, scopes },
    ], roles: [{ role: "MANAGER", label: "Manager commercial", description: "Responsabilité d’équipe explicite requise pour le périmètre Équipe.", users: 2, editable: true }], campuses: [{ id: "synthetic-campus", code: "Campus synthétique — libellé long de contrôle" }], global: true } });
    if (endpoint === "configuration") return route.fulfill({ json: { kind: "ROLE", role: "MANAGER", campus: "GLOBAL", version: 3, inherited: false, grants: { "lead.view": "OWN", "reporting.pilotage.view": "TEAM", "reporting.global.view": "NONE" }, globalCeiling: { "lead.view": "GLOBAL", "reporting.pilotage.view": "CAMPUS", "reporting.global.view": "NONE" } } });
    if (endpoint === "history") return route.fulfill({ json: { versions: [{ number: 3, createdAt: "2026-09-02T12:00:00Z", audits: [{ actorId: "private-synthetic-actor-id", actorRoles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", createdAt: "2026-09-02T12:00:00Z" }] }] } });
    return route.fulfill({ status: 503, json: { code: "synthetic_endpoint_unavailable" } });
  });
  await page.goto("/admin/roles");
  await expect(page.getByRole("heading", { name: "Configurer les permissions", exact: true })).toBeVisible();
  const center = page.locator("main.permission-center");
  await expect(center).not.toContainText("private-synthetic-actor-id");
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 768) await expect(page.locator("#crm-sidebar")).not.toBeVisible();
    const layout = await center.evaluate((element) => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      overflowing: [...element.querySelectorAll(".panel,.permission-context-selectors,.permission-module,.permission-row,.permission-row-copy,.permission-stats,.permission-actions,button,select")].filter((item) => {
        const bounds = item.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1 || item.scrollWidth > item.clientWidth + 1;
      }).map((item) => item.className || item.tagName),
    }));
    expect(layout.documentWidth, `Role center document at ${width}px`).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.overflowing, `Role context, rows and actions at ${width}px`).toEqual([]);
    const campus = page.getByRole("combobox", { name: "Campus", exact: true });
    const search = page.getByRole("searchbox", { name: "Rechercher une capacité", exact: true });
    const toggle = page.getByRole("switch", { name: "Activer cette capacité : Consulter les Leads", exact: true });
    const review = page.getByRole("button", { name: "Prévisualiser les changements", exact: true });
    for (const control of [campus, search, toggle, review]) {
      await control.focus(); await expect(control).toBeFocused();
      const size = await control.boundingBox();
      expect(size?.width, `Control width at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(size?.height, `Control height at ${width}px`).toBeGreaterThanOrEqual(44);
    }
    await search.focus(); await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Fonction", exact: true })).toBeFocused();
    await page.getByRole("combobox", { name: "Fonction", exact: true }).selectOption("reporting");
    await expect(page.getByRole("region", { name: "Pilotage", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Leads et dossiers", exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Fonction", exact: true }).selectOption("");
  }
});
