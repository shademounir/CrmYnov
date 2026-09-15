import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppointmentDetailPage from "../app/appointments/[appointmentId]/page.js";
import AppointmentsPage from "../app/appointments/page.js";
import LeadAppointmentsPage from "../app/leads/[leadId]/appointments/page.js";
import AppointmentReportingPage from "../app/manager/reports/appointments/page.js";
import { appointmentDate, appointmentsForView, appointmentState } from "../app/appointments/appointment-agenda.js";

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
});

test("lead appointment form contains controlled types and duration", async () => {
  const html = renderToStaticMarkup(await LeadAppointmentsPage({ params: Promise.resolve({ leadId: "00000000-0000-4000-8000-000000000149" }) }));
  for (const text of ["VISITE_CAMPUS", "ENTRETIEN_ADMISSION", "ENTRETIEN_MOTIVATION", "DISTANCIEL_NON_CONNECTE", "min=\"15\"", "max=\"480\"", "Aucun email, SMS, WhatsApp"]) assert.ok(html.includes(text));
});

test("detail documents scoped availability and append-only compensation", async () => {
  const html = renderToStaticMarkup(await AppointmentDetailPage({ params: Promise.resolve({ appointmentId: "appointment-synthetic" }) }));
  for (const text of ["Participants autorisés", "créneaux occupés", "Historique immuable", "événement compensatoire"]) assert.ok(html.includes(text));
});

test("reporting documents descriptive safeguards", () => {
  const html = renderToStaticMarkup(AppointmentReportingPage());
  assert.ok(html.includes("sans classement disciplinaire ni décision automatique"));
  assert.ok(html.includes("Réalisés / (Réalisés + Absents)"));
});
