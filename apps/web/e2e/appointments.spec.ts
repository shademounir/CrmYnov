import { expect, test } from "@playwright/test";

test("synthetic appointment agenda remains accessible and API-connected", async ({ page }) => {
  await page.route("**/api/crm/appointments?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "appointment-synthetic", startsAt: "2026-09-15T10:00:00Z", type: "VISITE_CAMPUS", mode: "SUR_SITE", state: "PLANIFIE", campus: "SYNTHETIC" }] }) }));
  await page.goto("/appointments?view=table&campus=Synthetic");
  await expect(page.getByRole("heading", { name: "Rendez-vous", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/calendriers externes désactivés/i)).toBeVisible();
  await expect(page.getByText("Visite du campus")).toBeVisible();
  await page.getByRole("link", { name: "Jour", exact: true }).focus();
  await expect(page.getByRole("link", { name: "Jour", exact: true })).toBeFocused();
});

test("planning from a Lead writes once and exposes the persistent agenda links", async ({ page }) => {
  const leadId = "00000000-0000-4000-8000-000000000149";
  let submissions = 0;
  await page.route(`**/api/crm/leads/${leadId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: leadId, leadCode: "LD-SYNTHETIC", firstName: "Recette", lastName: "Rendez-vous", campus: "SYNTHETIC-CAMPUS", campaign: "SYNTHETIC", educationLevel: "BAC", program: "SYNTHETIC", source: "TEST", status: "TO_CONTACT", collaboratorIds: [], temperature: "UNEVALUATED", temperatureLabel: "Non évalué", qualificationVersion: 0 }) }));
  await page.route(`**/api/crm/leads/${leadId}/appointments`, async (route) => {
    submissions += 1;
    const body = route.request().postDataJSON() as { startsAt: string; durationMinutes: number; idempotencyKey: string };
    const displayed = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(body.startsAt)).map((part) => [part.type, part.value]));
    expect(`${displayed.year}-${displayed.month}-${displayed.day}T${displayed.hour}:${displayed.minute}`).toBe("2099-03-01T10:30");
    expect(body.durationMinutes).toBe(45);
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "appointment-created" }) });
  });
  await page.goto(`/leads/${leadId}/appointments`);
  await page.getByLabel("Date et heure").fill("2099-03-01T10:30");
  await page.getByLabel("Durée").selectOption("45");
  await page.getByRole("button", { name: "Planifier le rendez-vous" }).click();
  await expect(page.getByText("Rendez-vous enregistré dans le CRM.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir le rendez-vous" })).toHaveAttribute("href", "/appointments/appointment-created");
  await expect(page.getByRole("link", { name: "Voir tous les rendez-vous" })).toHaveAttribute("href", "/appointments?view=table");
  expect(submissions).toBe(1);
});

test("records one durable no-show from the appointment detail", async ({ page }) => {
  const appointmentId = "appointment-no-show-synthetic";
  let transitions = 0;
  let state = "PLANIFIE";
  let version = 1;
  let events = [{ id: "event-created", type: "APPOINTMENT_CREATED", occurredAt: "2026-09-14T09:00:00Z" }];
  await page.route(`**/api/crm/appointments/${appointmentId}/state`, async (route) => {
    transitions += 1;
    const body = route.request().postDataJSON() as { state: string; reason?: string; expectedVersion: number; idempotencyKey: string };
    expect(body).toMatchObject({ state: "ABSENT", reason: "NO_SHOW_SYNTHETIC", expectedVersion: 1 });
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    state = "ABSENT";
    version = 2;
    events = [...events, { id: "event-absent", type: "APPOINTMENT_ABSENT", occurredAt: "2026-09-15T12:00:00Z" }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: appointmentId, state, version }) });
  });
  await page.route(`**/api/crm/appointments/${appointmentId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      appointment: { id: appointmentId, leadId: "lead-synthetic", type: "RENDEZ_VOUS_LIBRE", mode: "TELEPHONE", state, startsAt: "2026-09-14T10:00:00Z", durationMinutes: 30, campus: "SYNTHETIC", version, conflictWarning: false, overloadWarning: false },
      events,
    }) });
  });
  await page.goto(`/appointments/${appointmentId}`);
  await page.getByRole("button", { name: "Marquer comme non honoré" }).click();
  await page.getByLabel("Motif obligatoire").fill("NO_SHOW_SYNTHETIC");
  await page.getByRole("button", { name: "Confirmer le changement" }).click();
  await expect(page.getByText("Absence enregistrée dans l’historique protégé.")).toBeVisible();
  await expect(page.getByText("Absent", { exact: true })).toBeVisible();
  await expect(page.getByText("Absence constatée", { exact: true })).toBeVisible();
  expect(transitions).toBe(1);
});
