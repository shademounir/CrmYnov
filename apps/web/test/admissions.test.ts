import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AdmissionsAgendaPage from "../app/appointments/admissions/page";
import { AdmissionsApiError, admissionsDate, admissionsError, admissionsPeriod, admissionsToday, casablancaDateTimeToIso, sameAttempt, type AdmissionsBooking } from "../app/appointments/admissions/admissions-client";
import { admissionsAllowedActions } from "../app/appointments/admissions/booking-actions";

export const admissionsSyntheticBooking: AdmissionsBooking = { id: "appointment-synthetic", leadId: "lead-synthetic", leadIdentifier: "LD-SYNTHETIC", leadLabel: "Lead synthétique", responsibilityId: "responsibility-synthetic", responsibleId: "responsible-synthetic", responsibleLabel: "Responsable synthétique", requesterId: "requester-synthetic", campus: "SYNTHETIC", type: "ENTRETIEN_ADMISSION", mode: "SUR_SITE", state: "PENDING", appointmentState: "PLANIFIE", startsAt: "2099-10-04T09:00:00.000Z", endsAt: "2099-10-04T09:30:00.000Z", durationMinutes: 30, version: 1, canDecide: true, canCancel: true, canReschedule: true };

test("Admissions shell exposes the real loading state, manual calendar and no implied confirmation", () => {
  const html = renderToStaticMarkup(AdmissionsAgendaPage());
  assert.match(html, /Disponibilités et rendez-vous/u);
  assert.match(html, /Chargement de l’agenda Admissions/u);
  assert.match(html, /Calendrier externe, email, SMS et appels automatiques désactivés/u);
  assert.doesNotMatch(html, /Rendez-vous accepté/u);
});

test("Casablanca wall-time roundtrips and invalid dates are not silently normalized", () => {
  assert.equal(casablancaDateTimeToIso("2026-02-30T12:30"), undefined);
  assert.equal(casablancaDateTimeToIso("2026-10-04T25:30"), undefined);
  for (const day of ["2026-02-16", "2026-03-20", "2026-10-04"]) {
    const instant = casablancaDateTimeToIso(`${day}T12:30`); assert.ok(instant);
    assert.match(admissionsDate(instant), /12:30/u);
    const period = admissionsPeriod(day); assert.ok(period);
    assert.equal(admissionsToday(new Date(period.from)), day);
    assert.ok(new Date(period.to).valueOf() > new Date(period.from).valueOf());
  }
  assert.equal(admissionsPeriod("invalid"), undefined);
});

test("same payload retries preserve the command key but an edited payload gets a fresh key", () => {
  const ref: { current: { payload: string; key: string } | undefined } = { current: undefined };
  const first = sameAttempt(ref, { action: "REFUSE", reason: "Synthetic reason", expectedVersion: 1 });
  assert.equal(sameAttempt(ref, { action: "REFUSE", reason: "Synthetic reason", expectedVersion: 1 }), first);
  assert.notEqual(sameAttempt(ref, { action: "REFUSE", reason: "Edited reason", expectedVersion: 1 }), first);
});

test("action availability comes from API flags, not the Commercial role or assumed rights", () => {
  assert.deepEqual(admissionsAllowedActions(admissionsSyntheticBooking), ["ACCEPT", "REFUSE", "RESCHEDULE", "CANCEL"]);
  assert.deepEqual(admissionsAllowedActions({ ...admissionsSyntheticBooking, canDecide: false, canCancel: false, canReschedule: false }), []);
  assert.match(admissionsError(new AdmissionsApiError("permission_denied", 403)), /Accès refusé/u);
  assert.match(admissionsError(new AdmissionsApiError("admissions_booking_conflict", 409)), /saisie est conservée/u);
  assert.match(admissionsError(new AdmissionsApiError("authentication_required", 401)), /session a expiré/u);
  assert.doesNotMatch(admissionsError(new Error("private_database_url")), /private_database_url/u);
});
