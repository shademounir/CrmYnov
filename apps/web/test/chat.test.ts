import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InternalChatPage from "../app/chat/page.js";

test("renders a synthetic collaborator-only internal chat journey", () => {
  const html = renderToStaticMarkup(React.createElement(InternalChatPage));
  assert.match(html, /Chat interne/u);
  assert.match(html, /Aucun lead ne peut participer/u);
  assert.match(html, /Historique paginé des messages/u);
  assert.match(html, /Édition limitée à 60 minutes/u);
  assert.match(html, /pièces jointes différées/u);
  assert.doesNotMatch(html, /@ynov\.com|\+212|LD-2026/u);
});
