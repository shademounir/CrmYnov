import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InternalChatPage from "../app/chat/page.js";
import ConversationPage from "../app/chat/[conversationId]/page.js";

test("renders a persistent collaborator-only internal chat journey", () => {
  const html = renderToStaticMarkup(React.createElement(InternalChatPage));
  assert.match(html, /Chat interne/u);
  assert.match(html, /Conversations persistantes/u);
  assert.match(html, /Chargement depuis l’API locale/u);
  assert.match(html, /Créer via l’API/u);
  assert.match(html, /RBAC et appartenance vérifiés côté API/u);
  assert.match(html, /Aucun contenu de message dans les journaux/u);
  assert.doesNotMatch(html, /@ynov\.com|\+212|LD-2026/u);
});

test("renders a bounded notification destination without granting access", async () => {
  const html = renderToStaticMarkup(await ConversationPage({ params: Promise.resolve({ conversationId: "conversation-synthetic" }) }));
  assert.match(html, /contrôle d’appartenance côté API/u);
  assert.match(html, /aucun accès supplémentaire/u);
  assert.doesNotMatch(html, /@ynov\.com|\+212/u);
});
