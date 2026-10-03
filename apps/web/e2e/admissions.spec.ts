import { expect, test, type Page } from "@playwright/test";

// Browser presentation and keyboard proof only. Responses are controlled UI
// fixtures; actual PostgreSQL writes and concurrent reservations are tested separately.
const leadId = "00000000-0000-4000-8000-000000000175";
const responsibility = { id: "00000000-0000-4000-8000-000000000176", userId: "responsible", label: "Responsable synthétique Admissions", campus: "SYNTHETIC", active: true, version: 1 };
const booking = { id: "booking-layout-synthetic", leadId, leadIdentifier: "LD-SYNTHETIC", leadLabel: "Lead synthétique de recette", responsibilityId: responsibility.id, responsibleId: responsibility.userId, responsibleLabel: responsibility.label, requesterId: "requester", campus: "SYNTHETIC", state: "PENDING", appointmentState: "PLANIFIE", type: "ENTRETIEN_ADMISSION", mode: "SUR_SITE", startsAt: "2099-10-04T09:00:00.000Z", endsAt: "2099-10-04T09:30:00.000Z", durationMinutes: 30, version: 1, canDecide: true, canCancel: true, canReschedule: true };
async function fixtures(page: Page): Promise<void> {
  await page.route("**/api/crm/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") throw new Error("layout_fixture_must_not_mutate");
    let payload: unknown = { items: [] };
    if (path.endsWith("/sessions/current")) payload = { roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-synth" }], professionalEmail: "responsible@example.invalid" };
    else if (path.endsWith("/admissions/context")) payload = { timezone: "Africa/Casablanca", ownResponsibilities: [responsibility], canManageResponsibilities: false, canUseAgenda: true, eligibleUsers: [], campuses: [{ id: "campus-synth", code: "SYNTHETIC", label: "Campus synthétique de recette" }] };
    else if (path.endsWith("/admissions/responsibles")) payload = { items: [responsibility] };
    else if (path.endsWith("/admissions/slots")) payload = { items: [{ startsAt: booking.startsAt, endsAt: booking.endsAt }], redacted: true };
    else if (path.endsWith("/admissions/bookings")) payload = { items: [booking] };
    else if (path.endsWith("/admissions/windows")) payload = { items: [{ id: "window", responsibilityId: responsibility.id, campus: "SYNTHETIC", kind: "AVAILABLE", startsAt: booking.startsAt, endsAt: "2099-10-04T12:00:00.000Z", active: true, version: 1 }] };
    else if (path.endsWith(`/leads/${leadId}`)) payload = { id: leadId, leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "synthétique", campus: "SYNTHETIC", collaboratorIds: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}
async function containedControls(page: Page): Promise<void> {
  const issues = await page.locator("main.admissions-page").evaluate((main) => {
    const parent = main.getBoundingClientRect();
    return [...main.querySelectorAll("button, a, input:not([type=radio]), select, textarea")].filter((element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return style.display !== "none" && rect.width > 0 && (rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.height < 43);
    }).map((element) => ({ text: element.textContent, tag: element.tagName }));
  });
  expect(issues).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
}

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`Admissions real components retain accessible controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await fixtures(page);
    await page.goto(`/leads/${leadId}/appointments`);
    await expect(page.getByRole("heading", { name: /Planifier avec Lead synthétique/u })).toBeVisible();
    await page.getByLabel("Responsable d’admission").selectOption(responsibility.id);
    await expect(page.getByRole("radio").first()).toBeVisible(); await containedControls(page);
    await expect(page.getByText("Campus synthétique de recette", { exact: true }).last()).toBeVisible();
    await page.goto("/appointments/admissions");
    await expect(page.getByRole("heading", { name: "Déclarer une plage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accepter le rendez-vous" })).toBeVisible(); await containedControls(page);
    await page.getByRole("button", { name: "Refuser la demande" }).click();
    await expect(page.getByLabel("Motif obligatoire")).toBeFocused(); await containedControls(page);
    await page.keyboard.press("Escape"); await expect(page.getByLabel("Motif obligatoire")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refuser la demande" })).toBeFocused();
  });
}
