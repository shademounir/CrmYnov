import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzePlanBytes, publicFailure } from "../analyze-foundation-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../fixtures/foundation-positive.synthetic.json");
const casesPath = resolve(here, "../fixtures/negative-cases.synthetic.json");
const source = await readFile(fixturePath);
const baseline = JSON.parse(source.toString("utf8"));
const cases = JSON.parse(await readFile(casesPath, "utf8"));

function clone() {
  return structuredClone(baseline);
}

function allResources(plan) {
  const output = [];
  const visit = (module) => {
    output.push(...(module.resources ?? []));
    for (const child of module.child_modules ?? []) visit(child);
  };
  visit(plan.planned_values.root_module);
  return output;
}

function budget(plan) {
  return allResources(plan).find((item) => item.type === "google_billing_budget");
}

function encode(plan) {
  return Buffer.from(JSON.stringify(plan), "utf8");
}

function mutate(name) {
  const plan = clone();
  switch (name) {
    case "empty": return Buffer.alloc(0);
    case "whitespace": return Buffer.from("  \r\n", "utf8");
    case "invalid-json": return Buffer.from("{invalid", "utf8");
    case "utf16": return Buffer.from(JSON.stringify(plan), "utf16le");
    case "invalid-utf8": return Buffer.from([0xc3, 0x28]);
    case "array-root": return Buffer.from("[]", "utf8");
    case "delete-format": delete plan.format_version; break;
    case "bad-format": plan.format_version = "9.9"; break;
    case "delete-terraform-version": delete plan.terraform_version; break;
    case "delete-planned-values": delete plan.planned_values; break;
    case "delete-resource-changes": delete plan.resource_changes; break;
    case "child-modules-invalid": plan.planned_values.root_module.child_modules = {}; break;
    case "planned-address-duplicate": plan.planned_values.root_module.resources.push(structuredClone(plan.planned_values.root_module.resources[0])); break;
    case "change-address-duplicate": plan.resource_changes.push(structuredClone(plan.resource_changes[0])); break;
    case "planned-without-change": plan.resource_changes.pop(); break;
    case "change-without-planned": plan.planned_values.root_module.child_modules[0].resources.pop(); break;
    case "type-mismatch": plan.resource_changes[0].type = "google_project"; break;
    case "update": plan.resource_changes[0].change.actions = ["update"]; break;
    case "delete": plan.resource_changes[0].change.actions = ["delete"]; break;
    case "replace-delete-create": plan.resource_changes[0].change.actions = ["delete", "create"]; break;
    case "replace-create-delete": plan.resource_changes[0].change.actions = ["create", "delete"]; break;
    case "import": plan.resource_changes[0].change.importing = { id: "synthetic" }; break;
    case "unknown-action": plan.resource_changes[0].change.actions = ["forget"]; break;
    case "empty-actions": plan.resource_changes[0].change.actions = []; break;
    case "create-count": plan.resource_changes[0].change.actions = ["no-op"]; break;
    case "thirty-two-creates": {
      const extra = structuredClone(allResources(plan)[0]);
      extra.address = "module.extra.google_folder.this";
      plan.planned_values.root_module.resources.push(extra);
      const change = structuredClone(plan.resource_changes[0]);
      change.address = extra.address;
      plan.resource_changes.push(change);
      break;
    }
    case "unexpected-resource": {
      const item = allResources(plan)[0];
      item.type = "google_storage_bucket";
      plan.resource_changes[0].type = "google_storage_bucket";
      break;
    }
    case "budget-address": budget(plan).address = "module.unknown.google_billing_budget.this"; plan.resource_changes.at(-5).address = budget(plan).address; break;
    case "budget-amount": budget(plan).values.amount = []; break;
    case "budget-specified": budget(plan).values.amount[0].specified_amount = []; break;
    case "budget-currency": budget(plan).values.amount[0].specified_amount[0].currency_code = "EUR"; break;
    case "budget-units": budget(plan).values.amount[0].specified_amount[0].units = 8.5; break;
    case "budget-nanos": budget(plan).values.amount[0].specified_amount[0].nanos = -1; break;
    case "budget-nanos-329999999": budget(plan).values.amount[0].specified_amount[0].nanos = 329999999; break;
    case "budget-nanos-669999999": allResources(plan).find((item) => item.address.includes('["dev"]') && item.type === "google_billing_budget").values.amount[0].specified_amount[0].nanos = 669999999; break;
    case "budget-decimal-8-329999999": budget(plan).values.amount[0].specified_amount[0].units = 8.329999999; break;
    case "budget-decimal-33-329999999": allResources(plan).find((item) => item.address.includes('["staging"]') && item.type === "google_billing_budget").values.amount[0].specified_amount[0].units = 33.329999999; break;
    case "budget-decimal-183-329999999": allResources(plan).find((item) => item.address.includes('["folder"]') && item.type === "google_billing_budget").values.amount[0].specified_amount[0].units = 183.329999999; break;
    case "budget-value": budget(plan).values.amount[0].specified_amount[0].units = 9; break;
    case "budget-missing": {
      const target = budget(plan);
      const nested = plan.planned_values.root_module.child_modules[0].child_modules[0];
      nested.resources = nested.resources.filter((item) => item.address !== target.address);
      plan.resource_changes = plan.resource_changes.filter((item) => item.address !== target.address);
      break;
    }
    case "budget-duplicate": plan.planned_values.root_module.child_modules[0].child_modules[0].resources.push(structuredClone(budget(plan))); break;
    case "budget-value-unknown": plan.resource_changes.at(-5).change.after_unknown = { amount: [{ specified_amount: [{ units: true }] }] }; break;
    case "sensitive-input": plan.variables = { billing_account: { value: "SYNTHETIC-BILLING-ACCOUNT" }, token: { value: "synthetic-never-output" } }; break;
    default: throw new Error(`Unknown fixture mutation: ${name}`);
  }
  return encode(plan);
}

test("nominal Foundation fixture produces the exact redacted contract", () => {
  const summary = analyzePlanBytes(source);
  assert.equal(summary.valid, true);
  assert.match(summary.planSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(summary.actions, { create: 26, update: 0, delete: 0, replace: 0, import: 0, read: 0, noOp: 0 });
  assert.equal(summary.schemaVersion, 1);
  assert.deepEqual(summary.resourceTypes, {
    google_folder: 1,
    google_project: 3,
    google_billing_project_info: 3,
    google_project_service: 14,
    google_billing_budget: 5,
  });
  assert.deepEqual(summary.budgets, {
    bootstrap: { currency: "USD", units: 8, nanos: 330000000 },
    dev: { currency: "USD", units: 41, nanos: 670000000 },
    staging: { currency: "USD", units: 33, nanos: 330000000 },
    prod: { currency: "USD", units: 100, nanos: 0 },
    folder: { currency: "USD", units: 183, nanos: 330000000 },
  });
  assert.equal(summary.sensitiveDataDetected, false);
  assert.doesNotMatch(JSON.stringify(summary), /SYNTHETIC-BILLING-ACCOUNT|token|authorization|@/i);
});

for (const fixture of cases) {
  test(`synthetic fixture: ${fixture.name}`, () => {
    if (fixture.success) {
      const summary = analyzePlanBytes(mutate(fixture.mutation));
      assert.equal(summary.valid, true);
      assert.doesNotMatch(JSON.stringify(summary), /SYNTHETIC-BILLING-ACCOUNT|synthetic-never-output/i);
      return;
    }
    let caught;
    try {
      analyzePlanBytes(mutate(fixture.mutation));
    } catch (error) {
      caught = publicFailure(error);
    }
    assert.deepEqual(caught?.errorCode, fixture.errorCode);
    assert.deepEqual(Object.keys(caught ?? {}).sort(), Object.keys(caught?.address ? { valid: false, errorCode: "", category: "", address: "" } : { valid: false, errorCode: "", category: "" }).sort());
    assert.doesNotMatch(JSON.stringify(caught), /SYNTHETIC-BILLING-ACCOUNT|synthetic-never-output|authorization/i);
  });
}

test("hash is computed from exact input bytes", () => {
  const first = analyzePlanBytes(source);
  const second = analyzePlanBytes(Buffer.concat([source, Buffer.from("\n")]));
  assert.notEqual(first.planSha256, second.planSha256);
});

test("data source reads are visible and never counted as mutations", () => {
  const plan = clone();
  const data = { address: "data.google_client_config.synthetic", mode: "data", type: "google_client_config", name: "synthetic", values: {}, sensitive_values: {} };
  plan.planned_values.root_module.resources.push(data);
  plan.resource_changes.push({ address: data.address, mode: "data", type: data.type, name: data.name, change: { actions: ["read"], before: null, after: {}, after_unknown: {} } });
  const summary = analyzePlanBytes(encode(plan));
  assert.equal(summary.actions.create, 26);
  assert.equal(summary.actions.read, 1);
  assert.equal(summary.actions.update, 0);
});

test("versioned fixtures contain no email, real project ID, or credential marker", async () => {
  const fixtureText = `${source.toString("utf8")}\n${await readFile(casesPath, "utf8")}`;
  assert.doesNotMatch(fixtureText, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(fixtureText, /crmynov-(?:bst|dev|stg|prod)-n7x4q2/i);
  assert.doesNotMatch(fixtureText, /(?:authorization|private[_-]?key|client[_-]?secret|ya29\.)/i);
});
