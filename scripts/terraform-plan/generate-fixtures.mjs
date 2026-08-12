import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resources = [];

function resource(address, type, values = {}) {
  return { address, mode: "managed", type, name: "this", provider_name: "registry.terraform.io/hashicorp/google", schema_version: 0, values, sensitive_values: {} };
}

resources.push(resource("module.folder.google_folder.this", "google_folder", { display_name: "synthetic" }));
for (const env of ["bootstrap", "dev", "staging", "prod"]) {
  resources.push(resource(`module.projects[\"${env}\"].google_project.this`, "google_project", { project_id: `synthetic-${env}` }));
  resources.push(resource(`module.billing[\"${env}\"].google_billing_project_info.this`, "google_billing_project_info", { billing_account: "SYNTHETIC-BILLING-ACCOUNT" }));
}
for (let index = 1; index <= 17; index += 1) {
  resources.push(resource(`module.services[\"service-${String(index).padStart(2, "0")}\"].google_project_service.this`, "google_project_service", { service: `service-${index}.googleapis.com` }));
}
const budgetValues = { bootstrap: [8, 330000000], dev: [41, 670000000], staging: [33, 330000000], prod: [100, 0], folder: [183, 330000000] };
for (const [name, [units, nanos]] of Object.entries(budgetValues)) {
  resources.push(resource(`module.budgets[\"${name}\"].google_billing_budget.this`, "google_billing_budget", {
    amount: [{ specified_amount: [{ currency_code: "USD", units, nanos }] }],
  }));
}

const rootResources = resources.slice(0, 1);
const childResources = resources.slice(1);
const plan = {
  format_version: "1.2",
  terraform_version: "1.15.0",
  planned_values: { root_module: { resources: rootResources, child_modules: [{ address: "module.synthetic", resources: childResources.slice(0, 15), child_modules: [{ address: "module.synthetic.module.nested", resources: childResources.slice(15) }] }] } },
  resource_changes: resources.map((item) => ({ address: item.address, mode: item.mode, type: item.type, name: item.name, provider_name: item.provider_name, change: { actions: ["create"], before: null, after: item.values, after_unknown: {} } })),
  configuration: { provider_config: { google: { name: "google", full_name: "registry.terraform.io/hashicorp/google" } } },
};

await mkdir(resolve(here, "fixtures"), { recursive: true });
await writeFile(resolve(here, "fixtures", "foundation-positive.synthetic.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
