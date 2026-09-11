import assert from "node:assert/strict";
import test from "node:test";
import NewLeadPage from "../app/leads/new/page.js";
import { LeadCreationDrawer } from "../app/leads/lead-creation.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

test("renders the complete normalized lead creation form", () => {
  const page = NewLeadPage();
  assert.equal(page.type, "main");
  const html = renderToStaticMarkup(createElement(NewLeadPage));
  assert.match(html, /Créer un lead/); assert.match(html, /doublons/); assert.match(html, /Campus, formation et campagne/); assert.match(html, /select name="program"/); assert.match(html, /Formation/);
  const dom = new JSDOM(html);
  for (const field of ["firstName", "lastName", "educationLevel", "source", "campus", "program", "campaign"]) assert.equal(dom.window.document.querySelector(`[name="${field}"]`)?.hasAttribute("required"), true);
  dom.window.close();
  assert.match(html, /type="email"/); assert.match(html, /type="tel"/); assert.match(html, /Annuler/);
  const drawer = renderToStaticMarkup(createElement(LeadCreationDrawer));
  assert.match(drawer, /lead-create-trigger/); assert.match(drawer, /Nouveau lead/);
});
