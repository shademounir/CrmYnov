#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EXPECTED_TYPES = Object.freeze({
  google_folder: 1,
  google_project: 3,
  google_billing_project_info: 3,
  google_project_service: 14,
  google_billing_budget: 5,
});

const EXPECTED_BUDGETS = Object.freeze({
  bootstrap: { units: 8, nanos: 330000000 },
  dev: { units: 41, nanos: 670000000 },
  staging: { units: 33, nanos: 330000000 },
  prod: { units: 100, nanos: 0 },
  folder: { units: 183, nanos: 330000000 },
});

class PlanError extends Error {
  constructor(code, category, address) {
    super(code);
    this.code = code;
    this.category = category;
    this.address = safeAddress(address);
  }
}

function safeAddress(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.\[\]"-]{1,240}$/.test(value)
    ? value
    : undefined;
}

function refuse(code, category, address) {
  throw new PlanError(code, category, address);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectPlanned(module, resources = []) {
  if (!isRecord(module)) refuse("planned_module_invalid", "schema");
  if (module.resources !== undefined && !Array.isArray(module.resources)) {
    refuse("planned_resources_invalid", "schema");
  }
  resources.push(...(module.resources ?? []));
  if (module.child_modules !== undefined && !Array.isArray(module.child_modules)) {
    refuse("child_modules_invalid", "schema");
  }
  for (const child of module.child_modules ?? []) collectPlanned(child, resources);
  return resources;
}

function parseActions(change) {
  const actions = change?.change?.actions;
  if (!Array.isArray(actions) || actions.length === 0 || actions.some((x) => typeof x !== "string")) {
    refuse("actions_invalid", "actions", change?.address);
  }
  const key = actions.join(",");
  const kinds = {
    create: "create",
    update: "update",
    delete: "delete",
    read: "read",
    "no-op": "noOp",
    "delete,create": "replace",
    "create,delete": "replace",
  };
  if (!(key in kinds)) refuse("actions_unsupported", "actions", change?.address);
  if (change.change.importing !== undefined && change.change.importing !== null) return "import";
  return kinds[key];
}

function strictInteger(value, code, address) {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) refuse(code, "budget", address);
  return value;
}

function budgetName(address) {
  const match = /^module\.budgets\["(bootstrap|dev|staging|prod|folder)"\]\.google_billing_budget\.[A-Za-z0-9_-]+$/.exec(address);
  return match?.[1];
}

function parseBudget(resource) {
  const name = budgetName(resource.address);
  if (!name) refuse("budget_address_invalid", "budget", resource.address);
  const amount = resource.values?.amount;
  if (!Array.isArray(amount) || amount.length !== 1) refuse("budget_amount_invalid", "budget", resource.address);
  const specified = amount[0]?.specified_amount;
  if (!Array.isArray(specified) || specified.length !== 1) {
    refuse("budget_specified_amount_invalid", "budget", resource.address);
  }
  const money = specified[0];
  if (money?.currency_code !== "USD") refuse("budget_currency_invalid", "budget", resource.address);
  return {
    name,
    currency: "USD",
    units: strictInteger(money.units, "budget_units_invalid", resource.address),
    nanos: strictInteger(money.nanos, "budget_nanos_invalid", resource.address),
  };
}

function assertOutputSafe(summary) {
  const serialized = JSON.stringify(summary);
  const unsafe = [
    /[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}/i,
    /authorization/i,
    /api[_-]?token/i,
    /private[_-]?key/i,
    /client[_-]?secret/i,
    /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  ];
  if (unsafe.some((pattern) => pattern.test(serialized))) refuse("output_sensitive", "security");
}

export function analyzePlanBytes(bytes) {
  const planSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length === 0) refuse("input_empty", "encoding");
  if (bytes.includes(0)) refuse("input_not_utf8", "encoding");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    refuse("input_not_utf8", "encoding");
  }
  if (!source.trim()) refuse("input_empty", "encoding");
  let plan;
  try {
    plan = JSON.parse(source);
  } catch {
    refuse("json_invalid", "encoding");
  }
  if (!isRecord(plan)) refuse("plan_invalid", "schema");
  if (plan.format_version !== "1.2") refuse("format_version_unsupported", "schema");
  if (typeof plan.terraform_version !== "string" || !/^\d+\.\d+\.\d+/.test(plan.terraform_version)) {
    refuse("terraform_version_invalid", "schema");
  }
  if (!isRecord(plan.planned_values?.root_module)) refuse("planned_values_missing", "schema");
  if (!Array.isArray(plan.resource_changes)) refuse("resource_changes_missing", "schema");

  const planned = collectPlanned(plan.planned_values.root_module);
  const byAddress = new Map();
  for (const resource of planned) {
    if (!isRecord(resource) || !safeAddress(resource.address) || typeof resource.type !== "string") {
      refuse("planned_resource_invalid", "schema", resource?.address);
    }
    if (byAddress.has(resource.address)) refuse("planned_address_duplicate", "consistency", resource.address);
    byAddress.set(resource.address, resource);
  }

  const actionCounts = { create: 0, update: 0, delete: 0, replace: 0, import: 0, read: 0, noOp: 0 };
  const changedAddresses = new Set();
  const changesByAddress = new Map();
  for (const change of plan.resource_changes) {
    if (!isRecord(change) || !safeAddress(change.address) || typeof change.type !== "string") {
      refuse("resource_change_invalid", "schema", change?.address);
    }
    if (changedAddresses.has(change.address)) refuse("change_address_duplicate", "consistency", change.address);
    changedAddresses.add(change.address);
    changesByAddress.set(change.address, change);
    const kind = parseActions(change);
    actionCounts[kind] += 1;
    const plannedResource = byAddress.get(change.address);
    if (!plannedResource && !["delete"].includes(kind)) refuse("change_without_planned_resource", "consistency", change.address);
    if (plannedResource && plannedResource.type !== change.type) refuse("resource_type_mismatch", "consistency", change.address);
  }
  for (const resource of planned) {
    if (!changedAddresses.has(resource.address)) refuse("planned_resource_without_change", "consistency", resource.address);
  }

  for (const prohibited of ["update", "delete", "replace", "import"]) {
    if (actionCounts[prohibited] !== 0) refuse(`action_${prohibited}_forbidden`, "actions");
  }
  const plannedBudgetCount = planned.filter((item) => item.type === "google_billing_budget").length;
  if (plannedBudgetCount < 5) refuse("budget_missing", "budget");
  if (plannedBudgetCount > 5) refuse("budget_duplicate", "budget");
  if (actionCounts.create !== 26) refuse("create_count_mismatch", "contract");

  const typeCounts = Object.fromEntries(Object.keys(EXPECTED_TYPES).map((type) => [type, 0]));
  for (const resource of planned.filter((item) => item.mode !== "data")) {
    if (!(resource.type in typeCounts)) refuse("resource_type_unexpected", "contract", resource.address);
    typeCounts[resource.type] += 1;
  }
  for (const [type, expected] of Object.entries(EXPECTED_TYPES)) {
    if (typeCounts[type] !== expected) refuse("resource_type_count_mismatch", "contract");
  }

  const budgetResources = planned.filter((item) => item.type === "google_billing_budget");
  for (const resource of budgetResources) {
    const unknown = changesByAddress.get(resource.address)?.change?.after_unknown;
    if (containsUnknown(unknown?.amount)) refuse("budget_value_unknown", "budget", resource.address);
  }
  const budgets = budgetResources.map(parseBudget);
  const names = new Set();
  for (const budget of budgets) {
    if (names.has(budget.name)) refuse("budget_duplicate", "budget");
    names.add(budget.name);
    const expected = EXPECTED_BUDGETS[budget.name];
    if (budget.units !== expected.units || budget.nanos !== expected.nanos) {
      refuse("budget_value_mismatch", "budget");
    }
  }
  budgets.sort((a, b) => Object.keys(EXPECTED_BUDGETS).indexOf(a.name) - Object.keys(EXPECTED_BUDGETS).indexOf(b.name));
  const budgetSummary = Object.fromEntries(budgets.map(({ name, ...value }) => [name, value]));

  const summary = {
    schemaVersion: 1,
    valid: true,
    planSha256,
    terraformVersion: plan.terraform_version,
    formatVersion: plan.format_version,
    actions: actionCounts,
    resourceTypes: typeCounts,
    budgets: budgetSummary,
    sensitiveDataDetected: false,
  };
  assertOutputSafe(summary);
  return summary;
}

function containsUnknown(value) {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(containsUnknown);
  if (isRecord(value)) return Object.values(value).some(containsUnknown);
  return false;
}

export function publicFailure(error) {
  const failure = {
    valid: false,
    errorCode: error instanceof PlanError ? error.code : "internal_error",
    category: error instanceof PlanError ? error.category : "internal",
  };
  if (error instanceof PlanError && error.address) failure.address = error.address;
  return failure;
}

async function main() {
  if (process.argv.length !== 3) refuse("input_argument_invalid", "invocation");
  let bytes;
  try {
    bytes = await readFile(process.argv[2]);
  } catch {
    refuse("input_file_unreadable", "invocation");
  }
  process.stdout.write(`${JSON.stringify(analyzePlanBytes(bytes))}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify(publicFailure(error))}\n`);
    process.exitCode = 1;
  });
}
