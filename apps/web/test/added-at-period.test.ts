import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addedAtLabel, addedDayStart, addedPeriod, addedPeriodQuery, addedPreset, casablancaDay } from "../app/leads/added-at-period.js";
import { AddedAtFilters } from "../app/leads/added-at-filters.js";
import { LeadDirectoryTable } from "../app/leads/lead-directory.js";
import { LeadProfileView, type LeadProfileRecord } from "../app/leads/[leadId]/lead-profile.js";

test("profile entry timestamp stays in the visible dossier, never in the hidden secondary panel", () => {
  const lead: LeadProfileRecord = { id: "synthetic-profile", leadCode: "LD-SYNTH-PROFILE", firstName: "Test", lastName: "Synthétique",
    campus: "Casablanca", campaign: "Synthétique", educationLevel: "BAC", program: "Synthétique", source: "WEB_FORM",
    status: "CONTACTED", collaboratorIds: [], temperature: "UNEVALUATED", temperatureLabel: "Non évalué", qualificationVersion: 0,
    createdAt: "2026-10-20T09:00:00.000Z", acquisitionKind: "BASELINE", nextActionAt: "2026-10-21T09:30:00.000Z" };
  const html = renderToStaticMarkup(React.createElement(LeadProfileView, { lead, events: [] }));
  const dossier = html.match(/<aside[^>]*lead-profile__relation[\s\S]*?<\/aside>/u)?.[0] ?? "";
  assert.match(dossier, /<dt>Ajouté le<\/dt><dd><time dateTime="2026-10-20T09:00:00.000Z">/u);
  assert.ok(dossier.includes(addedAtLabel(lead.createdAt!)));
  assert.match(dossier, /Reprise historique · hors acquisitions nouvelles/u);
  assert.equal((html.match(/<dt>Ajouté le<\/dt>/gu) ?? []).length, 1);
  for (const createdAt of [undefined, "not-a-date"]) {
    const fixture = { ...lead };
    if (createdAt === undefined) delete fixture.createdAt;
    else fixture.createdAt = createdAt;
    const fallback = renderToStaticMarkup(React.createElement(LeadProfileView, { lead: fixture, events: [] }));
    assert.match(fallback, /<dt>Ajouté le<\/dt><dd>Date d’ajout indisponible<\/dd>/u);
    assert.doesNotMatch(fallback, /dateTime="not-a-date"/u);
  }
});

test("Casablanca presets freeze calendar days, not a guessed fixed UTC offset", () => {
  const now = new Date("2026-10-20T18:30:00Z");
  assert.deepEqual(addedPreset(1, now), addedPeriod("2026-10-20", "2026-10-20"));
  assert.deepEqual(addedPreset(7, now), addedPeriod("2026-10-14", "2026-10-20"));
  assert.deepEqual(addedPreset(30, now), addedPeriod("2026-09-21", "2026-10-20"));
  // Runtime IANA rules, including dates with a different Ramadan offset.
  for (const day of ["2026-02-20", "2026-04-20", "2026-10-20"]) {
    const iso = addedDayStart(day);
    assert.equal(casablancaDay(iso), day);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
    assert.equal(hour, "00:00");
  }
  assert.throws(() => addedPeriod("2026-02-30", "2026-03-01"));
  assert.throws(() => addedPeriod("2026-10-21", "2026-10-20"));
});
test("periods preserve whole-cohort dimensions and personal scope, clear conflicting inclusive end", () => {
  const current = new URLSearchParams({ view: "MINE", adviserId: "synthetic", campus: "CASABLANCA", campaign: "SYNTHETIC", source: "WEB_FORM", status: "CONTACTED", treatmentState: "DATED", createdTo: "2026-10-01", page: "4" });
  const period = addedPeriod("2026-10-19", "2026-10-20");
  const next = addedPeriodQuery(current, period, true);
  for (const key of ["view", "adviserId", "campus", "campaign", "source", "status", "treatmentState"]) assert.equal(next.get(key), current.get(key));
  assert.equal(next.get("createdFrom"), period.from); assert.equal(next.get("createdBefore"), period.to);
  assert.equal(next.has("createdTo"), false); assert.equal(next.get("page"), "1");
  const report = addedPeriodQuery(new URLSearchParams({ view: "personal", adviserId: "synthetic", period: "7d" }), period, false);
  assert.equal(report.get("period"), "custom"); assert.equal(report.get("from"), period.from); assert.equal(report.get("to"), period.to); assert.equal(report.get("view"), "personal");
});
test("visible entry timestamp and historical/new distinction without invented reception or treatment", () => {
  const html = renderToStaticMarkup(React.createElement(LeadDirectoryTable, { items: [
    { id: "synthetic-new", leadCode: "LD-SYNTH-NEW", firstName: "Test", lastName: "Synthétique", createdAt: "2026-10-20T09:00:00.000Z", acquisitionKind: "NEW", assignedToId: "synthetic-owner" },
    { id: "synthetic-baseline", leadCode: "LD-SYNTH-BASE", createdAt: "2026-10-20T08:00:00.000Z", acquisitionKind: "BASELINE" },
  ], ariaLabel: "Recette synthétique" }));
  assert.match(html, /Ajouté le/u); assert.match(html, /2026/u); assert.match(html, /Nouvelle acquisition · affectée/u); assert.match(html, /Reprise historique · pas une nouvelle demande/u);
  assert.match(addedAtLabel("2026-10-20T09:00:00Z"), /2026/u);
  const controls = renderToStaticMarkup(React.createElement(AddedAtFilters, { current: new URLSearchParams(), path: "/leads", directory: true }));
  for (const label of ["Aujourd’hui", "7 derniers jours", "30 derniers jours", "Plage personnalisée"]) assert.ok(controls.includes(label));
});
