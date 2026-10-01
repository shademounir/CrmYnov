import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppointmentDetailPage from "../app/appointments/[appointmentId]/page.js";
import AppointmentsPage from "../app/appointments/page.js";
import LeadAppointmentsPage from "../app/leads/[leadId]/appointments/page.js";
import AppointmentReportingPage from "../app/manager/reports/appointments/page.js";
import { appointmentAgendaSummary, appointmentDate, appointmentsForView, appointmentState } from "../app/appointments/appointment-agenda.js";
import { appointmentDurationOptions, appointmentTypeOptions, casablancaDateTimeToIso } from "../app/leads/[leadId]/appointments/lead-appointment-form.js";
import { appointmentEventLabel, appointmentEventReason, appointmentPrivacyNotice } from "../app/appointments/[appointmentId]/appointment-detail.js";
import { appointmentOutcomeAvailable, appointmentTransitionTargets } from "../app/appointments/[appointmentId]/appointment-state-actions.js";

test("agenda exposes the persistent accessible API view without external integration", () => {
  const html = renderToStaticMarkup(AppointmentsPage());
  assert.ok(html.includes("Rendez-vous"));
  assert.ok(html.includes("Chargement depuis l’API locale"));
  assert.ok(html.includes("Casablanca"));
  assert.ok(html.includes("calendriers externes désactivés"));
});

test("agenda localizes dates and applies the selected operational period", () => {
  const reference = new Date("2026-09-15T09:00:00Z");
  const items = [
    { id: "today", startsAt: "2026-09-15T10:00:00Z" },
    { id: "week", startsAt: "2026-09-18T10:00:00Z" },
    { id: "later", startsAt: "2026-09-25T10:00:00Z" },
  ];
  assert.deepEqual(appointmentsForView(items, "day", reference).map((item) => item.id), ["today"]);
  assert.deepEqual(appointmentsForView(items, "week", reference).map((item) => item.id), ["today", "week"]);
  assert.equal(appointmentsForView(items, "table", reference).length, 3);
  assert.equal(appointmentDate("invalid").date, "Date à vérifier");
  assert.equal(appointmentState("CONFIRME"), "Confirmé");
  const summary = appointmentAgendaSummary([
    { startsAt: "2026-09-15T10:00:00Z", state: "ABSENT" },
    { startsAt: "2026-09-15T11:00:00Z", state: "PLANIFIE" },
  ], reference);
  assert.equal(summary.find((metric) => metric.label === "Aujourd’hui")?.value, 2);
});

test("lead appointment form contains controlled types and duration", async () => {
  const html = renderToStaticMarkup(await LeadAppointmentsPage({ params: Promise.resolve({ leadId: "00000000-0000-4000-8000-000000000149" }) }));
  assert.ok(html.includes("Chargement du Lead"));
  for (const type of ["VISITE_CAMPUS", "ENTRETIEN_ADMISSION", "ENTRETIEN_MOTIVATION"] as const) assert.ok(appointmentTypeOptions.includes(type));
  assert.deepEqual(appointmentDurationOptions, [15, 30, 45, 60, 90, 120]);
  const instant = casablancaDateTimeToIso("2026-09-16T11:30");
  assert.ok(instant);
  assert.equal(new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit" }).format(new Date(instant)), "11:30");
});

test("detail documents scoped availability and append-only compensation", async () => {
  const html = renderToStaticMarkup(await AppointmentDetailPage({ params: Promise.resolve({ appointmentId: "appointment-synthetic" }) }));
  assert.ok(html.includes("Chargement depuis l’API locale"));
  assert.ok(appointmentPrivacyNotice.includes("créneaux occupés"));
  assert.equal(appointmentEventLabel("APPOINTMENT_CREATED"), "Rendez-vous créé");
  assert.equal(appointmentEventLabel("APPOINTMENT_ABSENT"), "Absence constatée");
  assert.equal(appointmentEventLabel("UNKNOWN_EVENT"), "Événement du rendez-vous");
  assert.equal(appointmentEventReason(" NO_SHOW "), "Motif : NO_SHOW");
  assert.equal(appointmentEventReason(" "), undefined);
  assert.equal(appointmentOutcomeAvailable({ startsAt: "2026-09-15T10:00:00Z", durationMinutes: 30 }, new Date("2026-09-15T10:29:59Z").valueOf()), false);
  assert.equal(appointmentOutcomeAvailable({ startsAt: "2026-09-15T10:00:00Z", durationMinutes: 30 }, new Date("2026-09-15T10:30:00Z").valueOf()), true);
  assert.deepEqual(appointmentTransitionTargets({ id: "appointment", state: "PLANIFIE", startsAt: "2099-01-01T10:00:00Z", durationMinutes: 30, version: 1 }), ["CONFIRME", "REPORTE", "ANNULE", "REFUSE"]);
});

test("reporting documents descriptive safeguards", () => {
  const html = renderToStaticMarkup(AppointmentReportingPage());
  assert.ok(html.includes("sans classement disciplinaire ni décision automatique"));
  assert.ok(html.includes("Réalisés / (Réalisés + Absents)"));
});
