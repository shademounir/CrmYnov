import { expect, test } from "@playwright/test";

const initial = { id: "request-synthetic", leadId: "lead-synthetic", currentOwnerId: "owner-synthetic", targetUserId: "target-synthetic", requestedBy: "requester-synthetic", reason: "Changement motivé de secteur", status: "PENDING", requestedAt: "2026-10-05T10:00:00Z", moveOpenTasks: true, version: 1, canDecide: true, currentOwnerLabel: "Commercial initial", targetUserLabel: "Commercial proposé", requesterLabel: "Demandeur synthétique", leadCode: "LD-SYNTHETIC" };

test("Manager reads bounded reassignment controls at the five shell widths without a business mutation", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-assignment-session", domain: "localhost", path: "/" }]);
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith("/sessions/current") ? { roles: ["MANAGER"], professionalEmail: "manager-synthetic@example.invalid", scopes: [{ kind: "CAMPUS", id: "campus-synthetic" }] }
      : path.endsWith("/reassignment-requests") ? { requests: [initial] }
        : path.endsWith("/assignment/dashboard") ? { leads: { total: 3, assigned: 2, unassigned: 1 }, activity: { pendingReassignments: 1 } }
          : path.endsWith("/telephony/me") ? { profile: null } : { items: [], unread: 0 };
    await route.fulfill({ status: 200, json: value });
  });
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/manager/assignment");
    await expect(page.getByRole("heading", { name: "Pilotage des affectations" })).toBeVisible();
    await expect(page.getByText("Commercial initial", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmer la décision", exact: true })).toBeVisible();
    await expect(page.getByText("Le propriétaire reste inchangé jusqu’à l’approbation distincte.", { exact: true })).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    await expect.poll(async () => page.locator(".sidebar").evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
    expect(await page.locator(".assignment-page").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const outside = await page.locator(".assignment-page :is(a,button,select,textarea)").evaluateAll((elements) => elements.filter((element) => {
      const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 1;
    }).map((element) => element.textContent));
    expect(outside).toEqual([]);
    const decision = page.getByRole("combobox", { name: "Décision", exact: true }); await decision.focus(); await expect(decision).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("textbox", { name: "Motif de la décision", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`reassignment-${width}px.png`), fullPage: true, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});

test("distinct decision uses a retained key after transport uncertainty then reloads owner and terminal request", async ({ page }) => {
  // Browser mock only. Real authentication, PostgreSQL and concurrency are proved by the isolated API suite.
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-assignment-session", domain: "localhost", path: "/" }]);
  let current = { ...initial }; let owner = "owner-synthetic"; const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/crm/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/decision")) {
      expect(route.request().method()).toBe("PATCH"); writes.push(route.request().postDataJSON() as Record<string, unknown>);
      if (writes.length === 1) { await route.abort("failed"); return; }
      current = { ...current, status: "APPROVED", version: 2, canDecide: false }; owner = "target-synthetic";
      await route.fulfill({ json: { request: { ...current, transferredFollowUpCount: 1 } } }); return;
    }
    expect(route.request().method()).toBe("GET");
    const value = path.endsWith("/sessions/current") ? { roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "campus-synthetic" }] }
      : path.endsWith("/reassignment-requests") ? { requests: [current] }
        : path.endsWith("/assignment-candidates") ? { candidates: [] }
          : path.endsWith("/leads/lead-synthetic") ? { id: "lead-synthetic", leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "Synthétique", status: "PROSPECT", assignedToId: owner, assignedToLabel: owner === "owner-synthetic" ? "Commercial initial" : "Commercial proposé" }
            : { items: [], unread: 0 };
    await route.fulfill({ json: value });
  });
  await page.goto("/leads/lead-synthetic/collaborators"); await expect(page.getByText("Commercial initial", { exact: true }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "Motif de la décision", exact: true }).fill("Décision motivée pour le dossier synthétique");
  const confirm = page.getByRole("button", { name: "Confirmer la décision", exact: true }); await confirm.click();
  await expect(page.getByRole("alert")).toContainText("clé de décision"); await confirm.click();
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]); expect(writes[0]).toMatchObject({ approved: true, expectedVersion: 1, idempotencyKey: expect.stringMatching(/^ui-reassignment-decision:/u) });
  await expect(page.getByText("Approuvée", { exact: true })).toBeVisible();
  await expect(page.locator(".lead-workflow-page__context")).toContainText("Commercial proposé");
  await page.reload(); await expect(page.locator(".lead-workflow-page__context")).toContainText("Commercial proposé");
  await expect(page.getByRole("button", { name: "Confirmer la décision", exact: true })).toHaveCount(0);
});

test("a read-only direct assignment route is honestly forbidden without a decision control", async ({ page }) => {
  await page.context().addCookies([{ name: "crm_session", value: "synthetic-readonly-session", domain: "localhost", path: "/" }]);
  await page.route("**/api/crm/**", async (route) => {
    expect(route.request().method()).toBe("GET"); const path = new URL(route.request().url()).pathname;
    await route.fulfill({ status: path.endsWith("/sessions/current") || path.endsWith("/notifications") ? 200 : 403,
      json: path.endsWith("/sessions/current") ? { roles: ["AUDITOR"], scopes: [{ kind: "CAMPUS", id: "campus-synthetic" }] } : { code: "forbidden", items: [], unread: 0 } });
  });
  await page.goto("/manager/assignment"); await expect(page.getByRole("alert").filter({ hasText: "Accès refusé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmer la décision", exact: true })).toHaveCount(0);
  await expect(page.locator('.sidebar a[href="/manager/assignment"]')).toHaveCount(0);
});
