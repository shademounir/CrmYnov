import assert from "node:assert/strict";
import test from "node:test";
import AccessRecoveryPage from "../app/access-recovery/page";
import { GENERIC_MESSAGE } from "../app/access-recovery/recovery-form";

test("exposes a recovery page with a non-enumerating message", () => {
  const page = AccessRecoveryPage();
  assert.equal(page.type, "main");
  assert.match(GENERIC_MESSAGE, /compte est éligible/);
  assert.doesNotMatch(GENERIC_MESSAGE, /existe|inconnu|introuvable/i);
});
