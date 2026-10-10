import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(infra, name), "utf8");
const main = read("modules/runtime-pilot/main.tf");
const variables = read("modules/runtime-pilot/variables.tf");
const observability = read("modules/runtime-pilot/observability.tf");
const outputs = read("modules/runtime-pilot/outputs.tf");

function block(source, type, name) {
  const match = new RegExp(`(?:resource|data)\\s+"${type}"\\s+"${name}"\\s*\\{`).exec(source);
  assert.ok(match, `${type}.${name} exists`);
  let depth = 1;
  let quoted = false;
  let escaped = false;
  for (let i = match.index + match[0].length; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`Unbalanced ${type}.${name}`);
}

test("only the two canonical projects and databases can be selected", () => {
  assert.match(variables, /contains\(\["staging", "prod"\], var\.environment\)/);
  assert.match(main, /staging\s*=\s*\{ project_id = "crmynov-stg-n7x4q2", database = "crmynov_stg", cidr = "10\.43\.0\.0\/24" \}/);
  assert.match(main, /prod\s*=\s*\{ project_id = "crmynov-prod-n7x4q2", database = "crmynov_prod", cidr = "10\.44\.0\.0\/24" \}/);
  assert.match(main, /region\s*=\s*"europe-west1"/);
  assert.doesNotMatch(main, /crmynov_(?:dev|staging)|crmynov-(?:dev|bst)-n7x4q2/);
});

test("project metadata, billing association and bootstrap identities are not created", () => {
  assert.match(main, /data "google_project" "current"/);
  assert.doesNotMatch(main, /resource "(?:google_project|google_billing_project_info|google_storage_bucket|google_iam_workload_identity_pool[^"\s]*|google_service_account_key)"/);
  assert.match(main, /data\.google_project\.current\.billing_account == var\.billing_account_id/);
  assert.doesNotMatch(main, /roles\/(?:owner|editor|iam\.serviceAccountKeyAdmin)/);
});

test("each thin root has its own backend and exact canonical module target", () => {
  const buckets = new Set();
  const prefixes = new Set();
  for (const [target, project] of [["staging", "crmynov-stg-n7x4q2"], ["prod", "crmynov-prod-n7x4q2"]]) {
    const root = read(`environments/${target}/main.tf`);
    const backend = read(`environments/${target}/backend.hcl.example`);
    assert.match(root, new RegExp(`project_id = "${project}"`));
    assert.match(root, new RegExp(`environment\\s*=\\s*"${target}"`));
    assert.match(root, /source\s*=\s*"\.\.\/\.\.\/modules\/runtime-pilot"/);
    const bucket = /bucket\s*=\s*"([^"]+)"/.exec(backend)?.[1];
    const prefix = /prefix\s*=\s*"([^"]+)"/.exec(backend)?.[1];
    assert.ok(bucket && prefix);
    assert.doesNotMatch(bucket, /dev|bst/);
    assert.ok(!buckets.has(bucket) && !prefixes.has(prefix));
    buckets.add(bucket); prefixes.add(prefix);
    assert.equal(read(`environments/${target}/.terraform.lock.hcl`), read("environments/dev/.terraform.lock.hcl"));
  }
});

test("Cloud SQL and useful stores have independent deletion safeguards", () => {
  const sql = block(main, "google_sql_database_instance", "postgres");
  assert.match(sql, /deletion_protection\s*=\s*true/);
  assert.match(sql, /deletion_protection_enabled\s*=\s*true/);
  assert.match(sql, /prevent_destroy\s*=\s*true/);
  assert.match(sql, /point_in_time_recovery_enabled\s*=\s*true/);
  assert.match(sql, /transaction_log_retention_days\s*=\s*7/);
  assert.match(sql, /ipv4_enabled\s*=\s*false/);
  assert.match(sql, /ssl_mode\s*=\s*"ENCRYPTED_ONLY"/);
  assert.match(block(main, "google_sql_database", "crm"), /prevent_destroy\s*=\s*true/);
  for (const name of ["database", "telephony", "gmail"]) {
    assert.match(block(main, "google_secret_manager_secret", name), /prevent_destroy\s*=\s*true/);
  }
});

test("no connector or load balancer is silently added to the DEV-like profile", () => {
  assert.match(main, /network_interfaces\s*\{/);
  assert.doesNotMatch(main, /resource "google_(?:vpc_access_connector|compute_forwarding_rule|compute_global_forwarding_rule|compute_url_map|dns_record_set)"/);
  assert.equal([...main.matchAll(/min_instance_count\s*=\s*0/g)].length, 2);
});

test("migration identity alone reads its secret; runtime identities are separate", () => {
  const migration = block(main, "google_secret_manager_secret_iam_member", "migration_database");
  const runtime = block(main, "google_secret_manager_secret_iam_member", "runtime_database");
  assert.match(migration, /runtime\["migrator"\]\.member/);
  assert.doesNotMatch(migration, /runtime\["(?:api|web|jobs)"\]/);
  assert.match(runtime, /toset\(\["api", "jobs"\]\)/);
  assert.match(main, /accounts\s*=\s*toset\(\["api", "web", "jobs", "migrator", "scheduler"\]\)/);
  assert.match(main, /CRM_RUNTIME_DATABASE_NAME = local\.target\.database/);
  assert.match(main, /CRM_RUNTIME_DATABASE_ENVIRONMENT = var\.environment/);
  assert.match(main, /CRM_RUNTIME_DATABASE_PROJECT = local\.project_id/);
  assert.match(main, /migrate = \{[^\n]*account = "migrator"/);
  assert.match(main, /grant\s*= \{[^\n]*account = "migrator"/);
  assert.doesNotMatch(main, /prisma[^\n]*seed|dist\/seed|seed\.js/);
  const dockerfile = read("../apps/api/Dockerfile");
  assert.match(dockerfile, /\/workspace\/apps\/api\/dist \.\/apps\/api\/dist/);
  for (const job of ["grant-runtime-database", "follow-up-due"]) {
    assert.match(main, new RegExp(`apps/api/dist/jobs/${job}\\.js`));
    assert.ok(read(`../apps/api/src/jobs/${job}.ts`).length > 0);
  }
});

test("all six ingestion flags are literal OFF and shared by API and jobs", () => {
  for (const flag of ["FORMINATOR_WEBHOOK_ENABLED", "SHEETS_ENABLED", "SHEET_CUTOVER_ENABLED", "CRM_GOOGLE_SHEETS_ENABLED", "SHEET_ROW_APPEND_ENABLED", "CRM_SHEET_APPEND_POLICY_QUALIFIED"]) {
    assert.match(main, new RegExp(`\\b${flag}\\s*=\\s*"false"`));
  }
  for (const [type, name] of [["google_cloud_run_v2_service", "api"], ["google_cloud_run_v2_job", "runtime"]]) {
    assert.match(block(main, type, name), /merge\(local\.disabled_ingestion,/);
  }
  assert.doesNotMatch(main, /sheets\.googleapis\.com|sheet-import\.js/);
});

test("Scheduler is created PAUSED with target-local job and identity", () => {
  const scheduler = block(main, "google_cloud_scheduler_job", "follow_up_due");
  assert.match(scheduler, /paused\s*=\s*true/);
  assert.match(scheduler, /projects\/\$\{local\.project_id\}/);
  assert.match(scheduler, /runtime\["due"\]\.name/);
  assert.match(scheduler, /runtime\["scheduler"\]\.email/);
});

test("only Web is publicly invokable; API requires the Web identity", () => {
  const publicWeb = block(main, "google_cloud_run_v2_service_iam_member", "public_web");
  assert.match(publicWeb, /web\[0\]\.name/);
  assert.match(publicWeb, /member\s*=\s*"allUsers"/);
  assert.equal([...main.matchAll(/member\s*=\s*"allUsers"/g)].length, 1);
  const apiInvoker = block(main, "google_cloud_run_v2_service_iam_member", "web_invokes_api");
  assert.match(apiInvoker, /api\[0\]\.name/);
  assert.match(apiInvoker, /runtime\["web"\]\.member/);
  assert.match(block(main, "google_cloud_run_v2_service", "web"), /CRM_API_USE_IAM = "true"/);
});

test("images and Gmail secret versions are immutable and target-bound", () => {
  assert.equal([...variables.matchAll(/@sha256:\[0-9a-f\]\{64\}/g)].length, 3);
  assert.equal([...main.matchAll(/startswith\(var\.(?:api|web|job)_image, "\$\{local\.registry\}/g)].length, 3);
  assert.match(variables, /\^\[1-9\]\[0-9\]\*\$/);
  assert.match(main, /toset\(keys\(var\.gmail_secret_versions\)\) == toset\(keys\(local\.gmail_secrets\)\)/);
  assert.doesNotMatch(main, /version\s*=\s*"latest"/);
  assert.match(main, /!var\.access_recovery_enabled \|\| \(var\.gmail_invitation_enabled && var\.crm_public_origin != ""\)/);
  assert.match(main, /startswith\(var\.crm_public_origin, "https:\/\/\$\{local\.prefix\}-web-"\)/);
  assert.match(block(main, "google_cloud_run_v2_service", "web"), /var\.crm_public_origin == self\.uri/);
  const mail = read("../apps/api/src/invitations/gmail-invitation.sender.ts");
  for (const flag of ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "CRM_PUBLIC_ORIGIN"]) {
    assert.match(main, new RegExp(`\\b${flag}\\b`));
    assert.match(mail, new RegExp(`\\b${flag}\\b`));
  }
});

test("each budget is USD150 for its own project and own alert channel", () => {
  const budget = block(observability, "google_billing_budget", "runtime");
  assert.match(budget, /currency_code\s*=\s*"USD"/);
  assert.match(budget, /units\s*=\s*"150"/);
  assert.match(budget, /projects\/\$\{data\.google_project\.current\.number\}/);
  assert.match(budget, /toset\(\[0\.5, 0\.8, 1\.0\]\)/);
  assert.match(budget, /CRM Ynov \$\{upper\(var\.environment\)\} runtime monthly alert/);
  assert.match(budget, /calendar_period\s*=\s*"MONTH"/);
  assert.match(budget, /credit_types_treatment\s*=\s*"INCLUDE_ALL_CREDITS"/);
  assert.match(budget, /spend_basis\s*=\s*"FORECASTED_SPEND"/);
  assert.match(budget, /google_monitoring_notification_channel\.operations\.id/);
  assert.match(budget, /prevent_destroy\s*=\s*true/);
  for (const target of ["staging", "prod"]) {
    const readme = read(`environments/${target}/README.md`);
    assert.match(readme, /adopt that SAME known native budget/);
    assert.match(readme, /Never create a second budget/);
    assert.match(readme, /It does not cap spending/);
  }
});

test("no payload credentials or actual private recipient enter examples or outputs", () => {
  assert.doesNotMatch(outputs, /secret_data|\.password|random_password|random_bytes|database_url|refresh_token/);
  for (const target of ["staging", "prod"]) {
    const example = read(`environments/${target}/terraform.tfvars.example`);
    assert.doesNotMatch(example, /@ynov\.com|@outlook\.fr|oauth|refresh_token|[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}/);
    assert.match(example, /deploy_services\s*=\s*false/);
    assert.match(example, /gmail_invitation_enabled\s*=\s*false/);
    assert.match(example, /access_recovery_enabled\s*=\s*false/);
  }
});

test("CI extends backend-free read-only-lock validation without removing prior roots", () => {
  const workflow = read("../.github/workflows/terraform-static.yml");
  assert.match(workflow, /for root in foundation phase0 state wif; do/);
  for (const root of ["bootstrap/dev-runtime-state", "environments/dev"]) {
    assert.ok(workflow.includes(`terraform -chdir="infra/${root}" validate -no-color`));
  }
  assert.match(workflow, /for target in staging prod; do[\s\S]*-backend=false[\s\S]*-lockfile=readonly[\s\S]*infra\/environments\/\$target" validate -no-color/);
  assert.match(workflow, /severity: HIGH,CRITICAL[\s\S]*exit-code: '1'/);
  const script = read("tests/validate-roots.ps1");
  for (const target of ["dev", "staging", "prod"]) assert.ok(script.includes(`environments\\${target}`));
  const mainWorkflow = read("../.github/workflows/main-release-gate.yml");
  assert.match(mainWorkflow, /for root in infra\/bootstrap\/foundation infra\/bootstrap\/phase0[\s\S]*infra\/bootstrap\/state infra\/bootstrap\/wif[\s\S]*infra\/bootstrap\/dev-runtime-state infra\/environments\/dev[\s\S]*infra\/environments\/staging infra\/environments\/prod; do[\s\S]*-backend=false[\s\S]*-lockfile=readonly[\s\S]*terraform -chdir="\$root" validate -no-color/);
  assert.match(mainWorkflow, /severity: HIGH,CRITICAL[\s\S]*exit-code: '1'/);
});
