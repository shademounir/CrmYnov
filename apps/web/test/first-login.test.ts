import assert from "node:assert/strict";
import test from "node:test";
import FirstLoginPage from "../app/first-login/page";

test("renders the isolated first-login secret replacement screen", () => {
  const page = FirstLoginPage();
  assert.equal(page.type, "main");
  assert.match(JSON.stringify(page.props), /Secret temporaire/);
  assert.match(JSON.stringify(page.props), /se reconnecter/);
});
