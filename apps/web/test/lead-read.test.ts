import assert from "node:assert/strict";
import test from "node:test";
import LeadsPage from "../app/leads/page.js";
import LeadDetailPage from "../app/leads/[leadId]/page.js";

test("renders shareable search and combined lead filters", () => { const rendered = JSON.stringify(LeadsPage()); assert.match(rendered, /Tous les leads/); assert.match(rendered, /Pagination/); assert.match(rendered, /assignedToId/); assert.match(rendered, /search/); assert.match(rendered, /method/); });
test("renders a role-aware lead detail", () => { const rendered = JSON.stringify(LeadDetailPage()); assert.match(rendered, /Fiche lead synthétique/); assert.match(rendered, /contacts sont masqués/); });
