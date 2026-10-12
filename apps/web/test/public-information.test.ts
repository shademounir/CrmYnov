import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicInformationPaths } from "../app/_components/public-information.js";
import AboutPage from "../app/(information)/about/page.js";
import PrivacyPage from "../app/(information)/privacy/page.js";
import TermsPage from "../app/(information)/terms/page.js";

test("public information bypass is exact and never exempts business or API paths", () => {
  assert.deepEqual([...publicInformationPaths], ["/about", "/privacy", "/terms"]);
  for (const path of ["/leads", "/admin/users", "/api/crm/leads", "/privacy/leads", "/about/api", "/terms/../admin"]) assert.equal(publicInformationPaths.has(path), false);
  const shell = readFileSync(new URL("../app/_components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /authPaths\.has\(pathname\) \|\| publicInformationPaths\.has\(pathname\)/u);
});

test("public notices render without session, business data or Google access", () => {
  for (const page of [AboutPage, PrivacyPage, TermsPage]) {
    const html = renderToStaticMarkup(createElement(page));
    assert.match(html, /<h1>/u);
    assert.doesNotMatch(html, /<script|<form|access_token|refresh_token|client_secret/u);
  }
  const privacy = renderToStaticMarkup(createElement(PrivacyPage));
  assert.match(privacy, /gmail\.send/u);
  assert.match(privacy, /spreadsheets\.readonly/u);
  assert.match(privacy, /ne recherche ni ne récupère les messages reçus/u);
  assert.match(privacy, /Secret Manager/u);
});

test("information navigation interlinks all notices without exposing API links", () => {
  const layout = readFileSync(new URL("../app/(information)/layout.tsx", import.meta.url), "utf8");
  for (const path of publicInformationPaths) assert.ok(layout.includes(`href="${path}"`));
  assert.ok(layout.includes('href="/"'));
  assert.ok(!layout.includes("/api/"));
});

test("public layout renders accessible navigation, secure login and unchanged child content", async () => {
  const cssUrl = new URL("../app/(information)/information.module.css", import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === cssUrl) return { format: "module", source: 'export default {page:"information-page",header:"information-header",brand:"information-brand"};', shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    const { default: InformationLayout } = await import("../app/(information)/layout.js");
    const html = renderToStaticMarkup(createElement(InformationLayout, { children: createElement("h1", null, "Notice publique") }));
    assert.match(html, /<nav aria-label="Informations publiques">/u);
    assert.match(html, /<main id="information-content"><h1>Notice publique<\/h1><\/main>/u);
    for (const path of publicInformationPaths) assert.ok(html.includes(`href="${path}"`));
    assert.match(html, /href="\/">Connexion sécurisée/u);
    assert.match(html, /mailto:casablancaynovcampus@gmail\.com/u);
    assert.doesNotMatch(html, /\/api\/|<form|<script|access_token|refresh_token/u);
  } finally {
    hooks.deregister();
  }
});
