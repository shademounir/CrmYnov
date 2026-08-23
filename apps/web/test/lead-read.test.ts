import assert from "node:assert/strict";
import test from "node:test";
import LeadsPage from "../app/leads/page.js";
import LeadDetailPage from "../app/leads/[leadId]/page.js";

test("renders the deterministic global lead list", () => { const rendered = JSON.stringify(LeadsPage()); assert.match(rendered, /Tous les leads/); assert.match(rendered, /Pagination/); });
test("renders a role-aware lead detail", () => { const rendered = JSON.stringify(LeadDetailPage()); assert.match(rendered, /Fiche lead synthétique/); assert.match(rendered, /contacts sont masqués/); });
