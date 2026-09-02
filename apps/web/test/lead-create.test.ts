import assert from "node:assert/strict";
import test from "node:test";
import NewLeadPage from "../app/leads/new/page.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("renders the complete normalized lead creation form", () => {
  const page = NewLeadPage(); const rendered = JSON.stringify(page);
  assert.equal(page.type, "main"); assert.match(rendered, /Créer un lead/); assert.match(rendered, /déduplication/); assert.match(rendered, /\/api\/crm\/leads/); assert.doesNotMatch(rendered, /name":"program/);
  const html = renderToStaticMarkup(createElement(NewLeadPage));
  assert.match(html, /Référentiels gouvernés/); assert.match(html, /select name="program"/); assert.match(html, /Formation/);
});
