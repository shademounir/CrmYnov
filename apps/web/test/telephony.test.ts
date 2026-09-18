import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TelephonyAdminPage from "../app/admin/telephony/page.js";
import CallQueuePage from "../app/calls/queue/page.js";
import { loadCallQueue } from "../app/calls/queue/call-queue.js";
import LeadCallsPage from "../app/leads/[leadId]/calls/page.js";
import { callStateLabel, LeadCallDrawer } from "../app/leads/[leadId]/lead-call-drawer.js";

test("renders the controlled Liblinphone workstation setup without SIP secrets", () => { const html = renderToStaticMarkup(TelephonyAdminPage()); for (const text of ["Postes d’appel Liblinphone", "Serveur SIP", "Collaborateur et extension", "Poste Windows", "Activer uniquement l’émission", "Aucun mot de passe SIP ne transite par le CRM"]) assert.ok(html.includes(text)); for (const forbidden of ["password", "token=", "secret sip value"]) assert.equal(html.toLowerCase().includes(forbidden), false); });
test("renders the operational call surfaces without fabricated call data", async () => { const detail = renderToStaticMarkup(await LeadCallsPage({ params: Promise.resolve({ leadId: "00000000-0000-4000-8000-000000000148" }) })); for (const text of ["Historique des appels", "sans exposer le numéro complet", "Chargement de l’historique"]) assert.ok(detail.includes(text)); const queue = renderToStaticMarkup(CallQueuePage()); for (const text of ["Appels à traiter", "Mode manuel local", "Aucun appel, webhook ou enregistrement audio réel", "Chargement de la file"]) assert.ok(queue.includes(text)); for (const fake of ["***123", "REQUESTED — événement synthétique"]) assert.equal(`${detail}${queue}`.includes(fake), false); });
test("loads queue data and preserves explicit session and malformed-response states", async () => {
  const queue = await loadCallQueue(() => Promise.resolve(Response.json({ missed: [], toVerify: [] }))); assert.deepEqual(queue, { kind: "ready", queue: { missed: [], toVerify: [] } });
  assert.equal((await loadCallQueue(() => Promise.resolve(Response.json({}, { status: 401 })))).kind, "session");
  assert.equal((await loadCallQueue(() => Promise.resolve(Response.json({ missed: [] })))).kind, "error");
});
test("renders a masked, fail-closed outbound action without browser credentials", () => {
  const html = renderToStaticMarkup(createElement(LeadCallDrawer, { leadId: "00000000-0000-4000-8000-000000000165", leadCode: "LD-TEL-165", phone: "+212600000165" }));
  for (const text of ["Appeler", "Appeler depuis le CRM", "••• 165", "agent Windows", "Aucun repli", "mode Linphone réel"]) assert.ok(html.includes(text));
  for (const forbidden of ["+212600000165", "TELEPHONY_LINPHONE_BRIDGE_SECRET", "sip:"]) assert.equal(html.includes(forbidden), false);
});
test("renders every SDK call state with a French operational label", () => {
  assert.deepEqual(["REQUESTED", "DIALING", "RINGING", "ANSWERED", "ENDED", "FAILED", "MISSED", "CANCELLED"].map((state) => callStateLabel(state as Parameters<typeof callStateLabel>[0])), ["Demande enregistrée", "Numérotation en cours", "Sonnerie en cours", "Appel décroché", "Appel terminé", "Appel en échec", "Sans réponse", "Appel annulé"]);
});
