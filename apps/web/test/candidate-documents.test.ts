import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CandidateDocumentsPage from "../app/leads/[leadId]/documents/page.js";
import CandidateDocumentDashboardPage from "../app/documents/dashboard/page.js";

test("renders an accessible synthetic checklist with controlled states and safeguards", async () => { const html = renderToStaticMarkup(await CandidateDocumentsPage({ params: Promise.resolve({ leadId: "00000000-0000-4000-8000-000000000147" }) })); for (const text of ["Checklist du dossier candidat", "Dossier incomplet", "À vérifier", "Manquant", "taille, MIME, signature et empreinte", "ne valide ni admission"]) assert.ok(html.includes(text)); assert.equal(html.includes("@"), false); });
test("renders URL-backed personal and global operational document views without PII", () => { const html = renderToStaticMarkup(CandidateDocumentDashboardPage()); for (const text of ["Filtres documentaires", "Ma vue Conseiller", "Vue Manager/Admin", "Exporter les agrégats sans PII", "Aucune donnée réelle"]) assert.ok(html.includes(text)); });
