import { expect, test } from "@playwright/test";

test("synthetic appointment agenda remains accessible and API-connected", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => hydrationErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydrat/iu.test(message.text())) hydrationErrors.push(message.text()); });
  await page.route("**/api/crm/appointments?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "appointment-synthetic", startsAt: "2026-09-15T10:00:00Z", type: "VISITE_CAMPUS", mode: "SUR_SITE", state: "PLANIFIE", campus: "SYNTHETIC" }] }) }));
  await page.goto("/appointments?view=table&campus=Synthetic");
  await expect(page.getByRole("heading", { name: "Rendez-vous", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/calendriers externes désactivés/i)).toBeVisible();
  await expect(page.getByText("Visite du campus")).toBeVisible();
  await page.getByRole("link", { name: "Jour", exact: true }).focus();
  await expect(page.getByRole("link", { name: "Jour", exact: true })).toBeFocused();
  expect(hydrationErrors).toEqual([]);
});

test("planning from a Lead requests a declared Admissions slot without presenting a mock as persistence", async ({ page }) => {
  const leadId = "00000000-0000-4000-8000-000000000149";
  const responsibilityId = "00000000-0000-4000-8000-000000000175";
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const startsAt = `${day}T10:30:00.000Z`;
  let submissions = 0; let created = false;
  const booking = { id: "appointment-created", leadId, leadIdentifier: "LD-SYNTHETIC", leadLabel: "Recette Rendez-vous", responsibilityId, responsibleId: "responsible", responsibleLabel: "Responsable synthétique", requesterId: "requester", campus: "SYNTHETIC-CAMPUS", type: "ENTRETIEN_ADMISSION", mode: "SUR_SITE", state: "PENDING", appointmentState: "PLANIFIE", startsAt, endsAt: `${day}T11:15:00.000Z`, durationMinutes: 45, version: 1, canDecide: false, canCancel: true, canReschedule: true };
  await page.route(`**/api/crm/leads/${leadId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: leadId, leadCode: "LD-SYNTHETIC", firstName: "Recette", lastName: "Rendez-vous", campus: "SYNTHETIC-CAMPUS", collaboratorIds: [] }) }));
  await page.route("**/api/crm/admissions/context", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ timezone: "Africa/Casablanca", ownResponsibilities: [], canManageResponsibilities: false, canUseAgenda: true, eligibleUsers: [], campuses: [{ id: "campus", code: "SYNTHETIC-CAMPUS", label: "Campus synthétique" }] }) }));
  await page.route("**/api/crm/admissions/responsibles?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: responsibilityId, userId: "responsible", label: "Responsable synthétique", campus: "SYNTHETIC-CAMPUS", active: true, version: 1 }] }) }));
  await page.route("**/api/crm/admissions/slots?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ startsAt, endsAt: booking.endsAt }], timezone: "Africa/Casablanca", redacted: true }) }));
  await page.route("**/api/crm/admissions/bookings?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: created ? [booking] : [] }) }));
  await page.route(`**/api/crm/leads/${leadId}/admissions-bookings`, async (route) => {
    submissions += 1;
    const body = route.request().postDataJSON() as { startsAt: string; durationMinutes: number; responsibilityId: string; idempotencyKey: string };
    expect(body).toMatchObject({ startsAt, durationMinutes: 45, responsibilityId });
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    created = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(booking) });
  });
  await page.goto(`/leads/${leadId}/appointments`);
  await page.getByLabel("Responsable d’admission").selectOption(responsibilityId);
  await page.getByRole("combobox", { name: "Durée", exact: true }).selectOption("45");
  await page.getByLabel("Jour recherché").fill(day);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Demander ce rendez-vous" }).click();
  await expect(page.getByText("Demande envoyée. Le créneau est réservé en attente de l’acceptation du responsable.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir la demande" })).toHaveAttribute("href", "/appointments/admissions/appointment-created");
  await expect(page.getByRole("button", { name: "Demander ce rendez-vous" })).toBeDisabled();
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
