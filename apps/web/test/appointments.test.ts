import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppointmentDetailPage from "../app/appointments/[appointmentId]/page.js";
import AppointmentsPage from "../app/appointments/page.js";
import LeadAppointmentsPage from "../app/leads/[leadId]/appointments/page.js";
import AppointmentReportingPage from "../app/manager/reports/appointments/page.js";

test("agenda exposes accessible day, week and table views without external integration", async () => {
  for (const [view, heading] of [["day", "Rendez-vous du jour"], ["week", "Semaine"], ["table", "Vue tableau"]] as const) {
    const html = renderToStaticMarkup(await AppointmentsPage({ searchParams: Promise.resolve({ view, campus: "Campus synthétique", adviserId: "synthetic-adviser" }) }));
    assert.ok(html.includes(heading));
    assert.ok(html.includes("Tableau accessible"));
    assert.ok(html.includes("Africa/Casablanca"));
    assert.ok(html.includes("Calendriers externes"));
  }
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
