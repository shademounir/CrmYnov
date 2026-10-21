import assert from "node:assert/strict";
import test from "node:test";
import { prepareBusinessMail, type BusinessMailFacts, type BusinessMailPolicy, type InternalMailMember, type PreparedBusinessMail } from "../src/business-mail/business-mail-policy.js";
import { renderBusinessMail } from "../src/business-mail/business-mail-template.js";

const at = new Date("2099-10-03T10:30:00Z"), deadline = new Date("2099-10-03T09:30:00Z");
const scope = { campusId: "synthetic-campus", campaignId: "synthetic-campaign" };
const member = (userId = "synthetic-owner", email = "owner@example.test"): InternalMailMember => ({ userId, email, active: true, hasLeadAccess: true, memberships: [{ ...scope }] });
const facts = (): BusinessMailFacts => ({ type: "FOLLOW_UP_DUE", resourceId: "synthetic-task", leadReference: "LD-SYNTHETIC", scope: { ...scope }, leadState: "OPEN", acquisition: "NEW", state: "DUE", actionOwnerId: "synthetic-owner", deadline, receivedAt: null, lastTreatmentAt: null, reportPresent: false, bookingState: "ACCEPTED" });
const policy = (): BusinessMailPolicy => ({ enabled: true, activatedAt: new Date("2099-10-03T00:00:00Z"), generatedAt: at, warningCadenceHours: 1, maximumWarnings: 3 });
function prepared(f = facts(), p = policy(), members = [member()]): PreparedBusinessMail {
  const r = prepareBusinessMail(f, p, members); assert.equal(r.status, "PREPARED"); if (r.status !== "PREPARED") throw new Error("fixture_not_prepared"); return r.message;
}
test("Internal business mail is disabled without an explicit activation baseline; old backlog is held", () => {
  assert.deepEqual(prepareBusinessMail(facts(), { ...policy(), enabled: false }, [member()]), { status: "HELD", reason: "DISABLED" });
  for (const activatedAt of [null, new Date("invalid"), new Date(at.valueOf() + 1)]) assert.equal(prepareBusinessMail(facts(), { ...policy(), activatedAt }, [member()]).status, "HELD");
  assert.deepEqual(prepareBusinessMail(facts(), { ...policy(), activatedAt: at }, [member()]), { status: "HELD", reason: "HISTORICAL_BACKLOG_REQUIRES_SEPARATE_WAVE" });
  assert.equal(prepareBusinessMail(facts(), { ...policy(), generatedAt: new Date("invalid") }, [member()]).status, "HELD");
});
test("To is the persistent action owner; copies require exact explicit active campus AND campaign membership and Lead access", () => {
  const copy = member("synthetic-copy", "copy@example.test");
  const excluded = [
    { ...member("other-campus", "foreign@example.test"), memberships: [{ campusId: "foreign", campaignId: scope.campaignId }] },
    { ...member("other-campaign", "foreign-campaign@example.test"), memberships: [{ ...scope, campaignId: "foreign" }] },
    { ...member("campus-only", "campus@example.test"), memberships: [{ ...scope, campaignId: null }] },
    { ...member("inactive", "inactive@example.test"), active: false },
    { ...member("denied", "denied@example.test"), hasLeadAccess: false },
    { ...member("candidate-only", "candidate@example.test"), memberships: [] },
  ];
  const result = prepared(facts(), policy(), [copy, ...excluded, member()]);
  assert.equal(result.to, "owner@example.test"); assert.deepEqual(result.cc, ["copy@example.test"]);
  assert.deepEqual(result.recipientUserIds, ["synthetic-owner", "synthetic-copy"]);
  assert.equal(prepareBusinessMail(facts(), policy(), [copy]).status, "HELD", "No reassigned Lead PRIMARY fallback");
  assert.equal(prepareBusinessMail(facts(), policy(), [{ ...member(), hasLeadAccess: false }]).status, "HELD");
});
test("Ambiguous identities, duplicate addresses and header injection fail closed", () => {
  for (const members of [[member(), member()], [member(), member("copy", "OWNER@example.test")], [member("synthetic-owner", "owner@example.test\r\nBcc: prospect@example.test")], [member(), member("copy", "invalid")]]) {
    assert.equal(prepareBusinessMail(facts(), policy(), members).status, "HELD");
  }
  for (const change of [{ type: "__proto__" }, { type: "constructor" }, { leadReference: "LD-X\nInjected" }, { resourceId: "bad\nvalue" }, { scope: { ...scope, campusId: "" } }]) {
    assert.equal(prepareBusinessMail({ ...facts(), ...change } as BusinessMailFacts, policy(), [member()]).status, "HELD");
  }
});
test("Closed Leads and completed/cancelled follow-ups never produce a prepared reminder", () => {
  for (const leadState of ["ENROLLED", "CLOSED_LOST", "CLOSED", "UNKNOWN"]) assert.equal(prepareBusinessMail({ ...facts(), leadState }, policy(), [member()]).status, "HELD");
  for (const state of ["COMPLETED", "CANCELLED", "UNKNOWN"]) assert.equal(prepareBusinessMail({ ...facts(), state }, policy(), [member()]).status, "HELD");
  assert.equal(prepareBusinessMail({ ...facts(), deadline: new Date(at.valueOf() + 1) }, policy(), [member()]).status, "HELD");
});
test("First treatment uses stable receipt strictly above24h, never creation/reset; BASELINE and treated/unknown excluded", () => {
  const f: BusinessMailFacts = { ...facts(), type: "FIRST_TREATMENT_OVERDUE", receivedAt: new Date(at.valueOf() - 86400000), deadline: null };
  assert.equal(prepareBusinessMail(f, policy(), [member()]).status, "HELD", "Equality is not overdue");
  const msg = prepared(f, { ...policy(), generatedAt: new Date(at.valueOf() + 1) }); assert.equal(msg.deadline, at.toISOString());
  for (const change of [{ acquisition: "BASELINE" }, { lastTreatmentAt: deadline }, { receivedAt: null }, { receivedAt: new Date("invalid") }]) assert.equal(prepareBusinessMail({ ...f, ...change } as BusinessMailFacts, { ...policy(), generatedAt: new Date(at.valueOf() + 1) }, [member()]).status, "HELD");
});
test("Warnings are bounded and anchored to persisted deadline, not job passages or template/recipient changes", () => {
  const f: BusinessMailFacts = { ...facts(), type: "FOLLOW_UP_OVERDUE" };
  for (const delta of [0, 1, 3599999]) assert.equal(prepareBusinessMail(f, { ...policy(), generatedAt: new Date(deadline.valueOf() + delta) }, [member()]).status, "HELD");
  const first = prepared(f), replay = prepared(f, { ...policy(), generatedAt: new Date(at.valueOf() + 1000) }, [member(), member("copy", "copy@example.test")]);
  assert.equal(first.key, replay.key); assert.equal(first.occurrence, 1);
  assert.notEqual(first.key, prepared(f, { ...policy(), generatedAt: new Date(at.valueOf() + 3600000) }).key);
  assert.equal(prepareBusinessMail(f, { ...policy(), generatedAt: new Date(deadline.valueOf() + 4 * 3600000) }, [member()]).status, "HELD");
  for (const change of [{ warningCadenceHours: 0 }, { warningCadenceHours: NaN }, { maximumWarnings: 31 }, { maximumWarnings: 1.5 }]) assert.equal(prepareBusinessMail(f, { ...policy(), ...change }, [member()]).status, "HELD");
  assert.equal(prepared().key, prepared(facts(), { ...policy(), generatedAt: new Date(at.valueOf() + 86400000) }).key, "One-shot due event identity remains stable across days");
});
test("Admissions confirmation requires real persisted deadline; return never infers attendance or no-show", () => {
  const confirmation: BusinessMailFacts = { ...facts(), type: "CONFIRMATION_EXPECTED", state: "PENDING", deadline: null };
  assert.equal(prepareBusinessMail(confirmation, policy(), [member()]).status, "HELD");
  assert.equal(prepared({ ...confirmation, deadline }).type, "CONFIRMATION_EXPECTED");
  for (const state of ["CONFIRME", "REFUSED", "CANCELLED"]) assert.equal(prepareBusinessMail({ ...confirmation, state, deadline }, policy(), [member()]).status, "HELD");
  const returning: BusinessMailFacts = { ...facts(), type: "RETURN_EXPECTED", state: "CONFIRME", deadline: at };
  assert.equal(prepared(returning).type, "RETURN_EXPECTED", "Exact end permits expectation, not absence");
  for (const state of ["REALISE", "ABSENT", "ANNULE", "REPORTE", "PENDING"]) assert.equal(prepareBusinessMail({ ...returning, state }, policy(), [member()]).status, "HELD");
  assert.equal(prepareBusinessMail({ ...returning, reportPresent: true }, policy(), [member()]).status, "HELD");
  for (const bookingState of [null, "PENDING", "REFUSED", "CANCELLED"]) assert.equal(prepareBusinessMail({ ...returning, bookingState }, policy(), [member()]).status, "HELD");
});
test("All five French templates have minimized content, stable reference, authenticated CRM entry and explicit observation", () => {
  const variants: BusinessMailFacts[] = [facts(), { ...facts(), type: "FOLLOW_UP_OVERDUE" },
    { ...facts(), type: "FIRST_TREATMENT_OVERDUE", receivedAt: new Date(deadline.valueOf() - 86400000) },
    { ...facts(), type: "CONFIRMATION_EXPECTED", state: "PENDING" }, { ...facts(), type: "RETURN_EXPECTED", state: "CONFIRME" }];
  for (const f of variants) {
    const output = renderBusinessMail(prepared(f), "https://crm.example.test");
    assert.match(output.subject, /\[CRM Ynov\]/); assert.match(output.subject, /LD-SYNTHETIC/); assert.match(output.text, /Échéance/);
    assert.match(output.text, /Africa\/Casablanca/); assert.match(output.text, /connexion requise/); assert.match(output.text, /https:\/\/crm.example.test\/leads/);
    assert(!output.text.includes("owner@example.test")); assert(!output.text.includes("synthetic-owner")); assert(!output.html.includes("<script"));
    assert(!/[\r\n]/.test(output.subject)); assert.match(output.text, /ne vaut ni réalisation/);
  }
  for (const origin of ["http://crm.example.test", "https://user:secret@crm.example.test", "https://crm.example.test/path", "https://crm.example.test?token=x", "https://crm.example.test/#x"]) assert.throws(() => renderBusinessMail(prepared(), origin));
  assert.throws(() => renderBusinessMail({ ...prepared(), type: "__proto__" } as unknown as PreparedBusinessMail, "https://crm.example.test"));
  assert.throws(() => renderBusinessMail({ ...prepared(), leadReference: "LD-X\r\nBcc: x" }, "https://crm.example.test"));
});
