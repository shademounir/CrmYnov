import { test, expect } from "@playwright/test";

test("CRMY-169 responsive role editor: preview, cancel, save, conflict, history and immutable reader", async ({ page }) => {
  const roles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"].map((role) => ({ role, label: role === "AUDITOR" ? "Lecteur" : role, users: 2, editable: true }));
  const catalogue = [
    { key: "lead.view", module: "lead", mutation: false, sensitive: false, reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] },
    { key: "lead.edit", module: "lead", mutation: true, sensitive: true, reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] },
  ];
  let version = 0, writes = 0, conflict = false;
  await page.route("**/api/crm/admin/role-permissions/**", async (route) => {
    const url = new URL(route.request().url()), endpoint = url.pathname.split("/").at(-1);
    const isWrite = route.request().method() === "POST";
    if (endpoint === "catalogue") return route.fulfill({ json: { catalogueVersion: 1, campus: "GLOBAL", catalogue, roles, campuses: [], global: true } });
    if (endpoint === "configuration" && !isWrite) return route.fulfill({ json: { kind: "ROLE", role: url.searchParams.get("role"), campus: "GLOBAL", version, inherited: version === 0, grants: { "lead.view": "CAMPUS", "lead.edit": url.searchParams.get("role") === "AUDITOR" ? "NONE" : "CAMPUS" }, globalCeiling: { "lead.view": "GLOBAL", "lead.edit": "GLOBAL" } } });
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
  const toggle = page.getByRole("switch", { name: "Activer lead.edit", exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await expect(page.getByRole("heading", { name: "Aperçu avant enregistrement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle version" })).toBeDisabled();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(writes).toBe(0); await expect(toggle).toBeChecked();
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await page.getByRole("checkbox", { name: "Je confirme les modifications et leurs conséquences sur les accès." }).check();
  await page.getByRole("button", { name: "Enregistrer la nouvelle version" }).click();
  await expect(page.getByRole("button", { name: "Restaurer la version 1" })).toBeVisible(); expect(writes).toBe(1);
  await page.getByRole("button", { name: "Expliquer mes droits dans ce contexte" }).click();
  await expect(page.getByRole("heading", { name: "Mes permissions effectives" })).toBeVisible();
  await page.getByRole("button", { name: "Restaurer la version 1" }).click();
  await expect(page.getByRole("heading", { name: "Confirmer la restauration de v1 ?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmer la restauration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restaurer la version 2" })).toBeVisible(); expect(writes).toBe(2);
  conflict = true;
  await toggle.uncheck(); await page.getByRole("button", { name: "Prévisualiser les changements" }).click();
  await page.getByRole("checkbox", { name: "Je confirme les modifications et leurs conséquences sur les accès." }).check();
  await page.getByRole("button", { name: "Enregistrer la nouvelle version" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Conflit de version" })).toBeVisible(); expect(writes).toBe(2);
  await page.getByRole("combobox", { name: "Rôle système", exact: true }).selectOption("AUDITOR");
  await expect(toggle).toBeDisabled(); await expect(toggle).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Lecteur : les permissions de mutation sont structurellement non attribuables.")).toBeVisible();
  const size = await toggle.boundingBox(); expect(size?.width).toBeGreaterThanOrEqual(44); expect(size?.height).toBeGreaterThanOrEqual(44);
  await page.getByLabel("Rechercher une permission", { exact: true }).fill("unknown-permission");
  await expect(page.getByText("Aucune permission correspondant à la recherche.")).toBeVisible();
});

test("CRMY-169 unavailable authorization service never renders permissive defaults", async ({ page }) => {
  await page.route("**/api/crm/admin/role-permissions/**", (route) => route.fulfill({ status: 503, json: { code: "permission_store_unavailable" } }));
  await page.goto("/admin/roles");
  await expect(page.getByRole("alert").filter({ hasText: "Aucun droit de secours" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle version" })).toHaveCount(0);
});
