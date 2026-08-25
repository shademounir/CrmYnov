import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import TelephonyAdminPage from "../app/admin/telephony/page.js";
import CallQueuePage from "../app/calls/queue/page.js";
import LeadCallsPage from "../app/leads/[leadId]/calls/page.js";

test("renders the Super Admin provider capability configuration without secrets", () => { const html = renderToStaticMarkup(TelephonyAdminPage()); for (const text of ["MANUAL_EXTERNAL", "COOVOX", "LINPHONE", "DISABLED", "provider_not_configured", "Activation réelle gelée"]) assert.ok(html.includes(text)); for (const forbidden of ["sip:", "password", "token="]) assert.equal(html.toLowerCase().includes(forbidden), false); });
test("renders a disabled call action, follow-up fields and unavailable recording", async () => { const html = renderToStaticMarkup(await LeadCallsPage({ params: Promise.resolve({ leadId: "00000000-0000-4000-8000-000000000148" }) })); for (const text of ["Fournisseur réel non configuré", "REQUESTED", "Commentaire de suivi", "Relance éventuelle", "Historique append-only", "UNAVAILABLE"]) assert.ok(html.includes(text)); assert.ok(html.includes("disabled")); assert.equal(html.includes("+212"), false); });
test("renders missed and verification queues without automatic lead mutation", () => { const html = renderToStaticMarkup(CallQueuePage()); for (const text of ["Appels manqués", "À vérifier", "confirmation humaine", "Aucun lead n’est créé ou réaffecté automatiquement", "***123"]) assert.ok(html.includes(text)); });
