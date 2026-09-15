import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import LeadsPage, { leadPageMode } from "../app/leads/page.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LeadProfileView,
  formatDate,
  interactionResultLabel,
  lastContactSummary,
  leadDisplayName,
  leadSectionHref,
  leadSourceLabel,
  leadStatusLabel,
  timelineEventLabel,
  type LeadProfileRecord,
} from "../app/leads/[leadId]/lead-profile.js";
import { interactionBody } from "../app/leads/[leadId]/lead-interaction-drawer.js";
import { followUpBody } from "../app/leads/[leadId]/lead-follow-up-drawer.js";
import { statusBody } from "../app/leads/[leadId]/lead-status-drawer.js";
import { failureMessage, nextActionChronologyError, StatusWorkflowForm, statusJourneyState, statusTransitionOptions } from "../app/leads/[leadId]/lead-workflow-forms.js";
import { LeadDirectoryTable, followUpDate, leadDirectoryInitials, leadDirectoryNameParts, leadDirectoryStatus } from "../app/leads/lead-directory.js";

function renderStructure(value: unknown): string {
  return JSON.stringify(value, (key: string, item: unknown): unknown =>
    key === "type" && typeof item === "object" ? "component" : item,
  );
}

test("wraps the Lead directory in a client suspense boundary", () => { const rendered = renderStructure(LeadsPage()); assert.match(rendered, /fallback/); });
test("selects the dedicated follow-up presentation without changing other work views", () => { assert.equal(leadPageMode("FOLLOW_UP"), "follow-up"); assert.equal(leadPageMode("follow_up"), "follow-up"); assert.equal(leadPageMode("ALL"), "directory"); });
test("renders compact, localized Lead directory rows without exposing adviser UUIDs", () => {
  const item = { id: "lead-1", leadCode: "LD-2026-SYNTH", firstName: "Camille", lastName: "Essai", status: "QUALIFIED", temperature: "HOT", temperatureLabel: "Chaud", program: "Programme synthétique", assignedToId: "00000000-0000-4000-8000-000000000172" };
  const html = renderToStaticMarkup(createElement(LeadDirectoryTable, { items: [item], ariaLabel: "Leads" }));
  for (const expected of ["1 prospect", "Camille", "Essai", "LD-2026-SYNTH", "Qualifié", "Chaud", "Programme synthétique", "Affecté", "Ouvrir la fiche LD-2026-SYNTH"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /00000000-0000-4000-8000-000000000172/u);
  assert.deepEqual(leadDirectoryNameParts({ firstName: "ًٌْ٢٠٠٥", lastName: "Bargam" }), ["Bargam"]);
  assert.equal(leadDirectoryInitials(item), "CE");
  assert.equal(leadDirectoryStatus("PROSPECT"), "Prospect");
  assert.equal(leadDirectoryStatus("UNKNOWN"), "À vérifier");
});
test("renders a task-first follow-up row with an explicit Casablanca due date", () => {
  const item = { id: "lead-follow-up", leadCode: "LD-SYN-DUE", firstName: "Sam", lastName: "Essai", status: "CONTACTED", temperature: "WARM", temperatureLabel: "Tiède", program: "Programme synthétique", nextActionAt: "2026-09-15T09:30:00.000Z" };
  const html = renderToStaticMarkup(createElement(LeadDirectoryTable, { items: [item], ariaLabel: "Relances", context: "follow-up" }));
  for (const expected of ["Échéance", "15 sept., 10:30", "À traiter", "LD-SYN-DUE", "Ouvrir la fiche LD-SYN-DUE"]) assert.match(html, new RegExp(expected));
  assert.equal(followUpDate("invalid"), "Date à vérifier");
  assert.doesNotMatch(html, /Tiède/u);
});
test("renders a role-aware unified lead profile", () => {
  const lead: LeadProfileRecord = {
    id: "00000000-0000-4000-8000-000000000171",
    leadCode: "LD-SYN-171",
    firstName: "Camille",
    lastName: "Essai",
    campus: "Casablanca",
    campaign: "Rentrée synthétique",
    educationLevel: "BAC",
    program: "Programme synthétique",
    source: "Formulaire de démonstration",
    status: "PROSPECT",
    assignedToId: "00000000-0000-4000-8000-000000000172",
    collaboratorIds: [],
    temperature: "HOT",
    temperatureLabel: "Chaud",
    qualificationVersion: 1,
  };
  const html = renderToStaticMarkup(createElement(LeadProfileView, { lead, events: [], actionMessage: "Qualification commerciale enregistrée." }));
  for (const expected of ["Camille Essai", "À contacter", "Situation commerciale", "Chaud", "Qualifier", "Réaffecter", "Réaffecter ce Lead", "Ajouter une interaction", "Modifier le statut", "Planifier une relance", "Historique des interactions", "Coordonnées", "Masquées ou indisponibles", "Documents", "Ouvrir la gestion détaillée", "Injoignable", "Qualification commerciale enregistrée"]) assert.match(html, new RegExp(expected));
  assert.equal(html.includes("00000000-0000-4000-8000-000000000172"), false);
  assert.equal(leadSectionHref("lead/id", "timeline"), "/leads/lead%2Fid/timeline");
  assert.doesNotMatch(html, /title="Affectez d’abord/u);
});
test("keeps an unassigned Lead in context while explaining how to unlock follow-up planning", () => {
  const lead: LeadProfileRecord = {
    id: "00000000-0000-4000-8000-000000000173",
    leadCode: "LD-SYN-UNASSIGNED",
    firstName: "Alex",
    lastName: "Synthétique",
    campus: "Casablanca",
    campaign: "Rentrée synthétique",
    educationLevel: "BAC",
    program: "Programme synthétique",
    source: "WEB_FORM",
    status: "PROSPECT",
    collaboratorIds: [],
    temperature: "UNEVALUATED",
    temperatureLabel: "Non évalué",
    qualificationVersion: 0,
  };
  const html = renderToStaticMarkup(createElement(LeadProfileView, { lead, events: [] }));
  for (const expected of ["Affecter ce Lead", "Conseiller cible", "Prévisualiser", "Confirmer l’affectation", "Prévisualisez la décision avant de confirmer", "Planifier une relance", "Affectation nécessaire", "Une relance doit avoir un conseiller responsable", "sans quitter la fiche"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /Réaffecter ce Lead/u);
  assert.doesNotMatch(html, /title="Affectez d’abord le Lead à un conseiller"/u);
});
test("uses business labels and neutral fallbacks", () => {
  assert.equal(leadDisplayName({ firstName: " ", lastName: "" }), "Prospect indisponible");
  assert.equal(leadDisplayName({ firstName: "ًٌْ٢٠٠٥", lastName: "Bargam" }), "Bargam");
  assert.equal(leadStatusLabel("QUALIFIED"), "Qualifié");
  assert.equal(leadStatusLabel("UNKNOWN"), "Statut à vérifier");
  assert.equal(leadSourceLabel("WEB_FORM"), "Formulaire web");
  assert.equal(leadSourceLabel("Source partenaire"), "Source partenaire");
  assert.equal(timelineEventLabel("ASSIGNMENT_CHANGED"), "Affectation mise à jour");
  assert.equal(timelineEventLabel("UNKNOWN"), "Événement de suivi");
  assert.equal(interactionResultLabel("NO_ANSWER"), "Injoignable");
  assert.equal(interactionResultLabel("FOLLOW_UP_REQUIRED"), "Relance nécessaire");
});
test("isolates mixed writing directions without altering the lead identity", () => {
  const lead: LeadProfileRecord = {
    id: "00000000-0000-4000-8000-000000000174",
    leadCode: "LD-SYN-BIDI",
    firstName: "سلمى",
    lastName: "Bargam",
    campus: "Casablanca",
    campaign: "Rentrée synthétique",
    educationLevel: "BAC",
    program: "Programme synthétique",
    source: "WEB_FORM",
    status: "PROSPECT",
    collaboratorIds: [],
    temperature: "UNEVALUATED",
    temperatureLabel: "Non évalué",
    qualificationVersion: 0,
  };
  const html = renderToStaticMarkup(createElement(LeadProfileView, { lead, events: [] }));
  assert.equal(leadDisplayName(lead), "سلمى Bargam");
  assert.match(html, /<bdi dir="auto">سلمى<\/bdi> <bdi dir="auto">Bargam<\/bdi>/u);
});
test("keeps the commercial stage separate from the latest contact result", () => {
  const events = [
    { id: "event-1", type: "PHONE_CALL", result: "NO_ANSWER", occurredAt: "2026-09-09T09:00:00.000Z" },
    { id: "event-2", type: "CRM_CALL", result: "NO_ANSWER", occurredAt: "2026-09-08T09:00:00.000Z" },
    { id: "event-3", type: "LEAD_CREATED", result: "SUCCESS", occurredAt: "2026-09-06T09:00:00.000Z" },
  ];
  assert.equal(lastContactSummary(events), "Injoignable — 2 tentatives");
  assert.equal(lastContactSummary([{ id: "event-4", type: "MANUAL_EMAIL", result: "CONNECTED", occurredAt: "2026-09-09T10:00:00.000Z" }, ...events]), "Contact établi");
  assert.equal(lastContactSummary([]), "Aucun contact enregistré");
});
test("builds the existing timeline contract from the contextual interaction panel", () => {
  const form = new FormData();
  form.set("type", "MEETING");
  form.set("result", "FOLLOW_UP_REQUIRED");
  form.set("note", " Note synthétique ");
  form.set("nextActionAt", "2026-09-10T10:30");
  assert.deepEqual(interactionBody(form), { type: "MEETING", result: "FOLLOW_UP_REQUIRED", note: "Note synthétique", nextActionAt: new Date("2026-09-10T10:30").toISOString() });
});
test("builds the existing status and follow-up contracts from contextual panels", () => {
  const status = new FormData();
  status.set("status", "CLOSED_LOST");
  status.set("reason", " Décision synthétique ");
  assert.deepEqual(statusBody(status), { status: "CLOSED_LOST", reason: "Décision synthétique" });

  const followUp = new FormData();
  followUp.set("dueAt", "2026-09-12T10:30");
  followUp.set("reason", " Relance synthétique ");
  assert.deepEqual(followUpBody(followUp), { dueAt: new Date("2026-09-12T10:30").toISOString(), reason: "Relance synthétique" });
});
test("only proposes direct stage transitions and explains terminal validation", () => {
  assert.deepEqual(statusTransitionOptions("PROSPECT"), [{ value: "CONTACTED", label: "Contacté" }]);
  assert.deepEqual(statusTransitionOptions("CONTACTED"), [{ value: "QUALIFIED", label: "Qualifié" }]);
  assert.deepEqual(statusTransitionOptions("QUALIFIED"), []);
  assert.match(failureMessage("status", 400, "lead_status_transition_forbidden"), /n’est pas disponible depuis l’étape actuelle/u);
  assert.match(failureMessage("status", 403), /autorisation/u);
  assert.match(failureMessage("status", 409), /Actualisez/u);
  assert.match(failureMessage("interaction", 401), /session a expiré/u);
  assert.match(failureMessage("interaction", 401), /Aucune modification n’a été enregistrée/u);
  assert.equal(statusJourneyState("CONTACTED", "PROSPECT"), "completed");
  assert.equal(statusJourneyState("CONTACTED", "CONTACTED"), "current");
  assert.equal(statusJourneyState("CONTACTED", "QUALIFIED"), "upcoming");
  assert.match(failureMessage("interaction", 400, "next_action_chronology_invalid"), /postérieure/u);
  assert.equal(nextActionChronologyError("2099-09-12T10:30:00.000Z", new Date("2026-09-11T10:00:00.000Z")), undefined);
  assert.match(nextActionChronologyError("2026-09-10T10:30:00.000Z", new Date("2026-09-11T10:00:00.000Z")) ?? "", /postérieure/u);
  const html = renderToStaticMarkup(createElement(StatusWorkflowForm, { leadId: "synthetic-lead", currentStatus: "CONTACTED" }));
  for (const expected of ["Parcours commercial", "Étape suivante autorisée", "Qualifié", "Inscrit / Sans suite", "température commerciale reste indépendante"]) assert.match(html, new RegExp(expected));
});
test("renders timestamps in French using the explicit Africa/Casablanca timezone", () => {
  assert.equal(formatDate("2026-09-11T23:30:00.000Z"), "12 sept., 00:30");
  assert.equal(formatDate(undefined), "Non planifiée");
});
test("keeps every Lead action inside the medium desktop viewport", () => {
  const css = readFileSync(new URL("../app/leads/lead-profile.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 1360px\) and \(min-width: 821px\)[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.match(css, /\.lead-profile__actions > \.primary-button,[\s\S]*min-width: 0/u);
});
test("keeps commercial context and actions ahead of the dossier on mobile", () => {
  const css = readFileSync(new URL("../app/leads/lead-profile.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.lead-profile__commercial \{ order: 3; \}[\s\S]*\.lead-profile__actions \{ order: 4; \}[\s\S]*\.lead-profile__relation \{ order: 5; \}/u);
  assert.match(css, /\.lead-profile__actions > \.secondary-button:last-of-type \{ grid-column: 1 \/ -1; \}/u);
});
