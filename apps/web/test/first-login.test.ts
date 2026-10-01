import assert from "node:assert/strict";
import test from "node:test";
import FirstLoginPage from "../app/first-login/page";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("renders the isolated first-login secret replacement screen", () => {
  const page = renderToStaticMarkup(createElement(FirstLoginPage));
  assert.match(page, /Secret temporaire/);
  assert.match(page, /Confirmer le nouveau secret/);
  assert.match(page, /Se déconnecter/);
});
