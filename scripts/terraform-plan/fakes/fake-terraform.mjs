import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const command = args.find((value) => ["version", "fmt", "init", "validate", "plan", "show"].includes(value));
const scenario = process.env.FAKE_TERRAFORM_SCENARIO || "success";
const logPath = process.env.FAKE_TERRAFORM_LOG;
const fixturePath = process.env.FAKE_TERRAFORM_FIXTURE;

if (logPath) {
  appendFileSync(logPath, JSON.stringify({ command, args, tfDataDir: process.env.TF_DATA_DIR || null }) + "\n", "utf8");
}

const fail = (name) => {
  if (scenario === `fail_${name}`) {
    process.stderr.write("native failure SYNTHETIC-BILLING-ID-SENTINEL Bearer SYNTHETIC-TOKEN-SECRET\n");
    process.exit(17);
  }
};

if (!command) process.exit(2);
fail(command);

if (command === "version") {
  process.stdout.write("Terraform v1.15.8\n");
  process.exit(0);
}
if (["fmt", "init", "validate"].includes(command)) {
  process.stdout.write(`${command} ok\n`);
  process.exit(0);
}
if (command === "plan") {
  const output = args.find((value) => value.startsWith("-out="))?.slice(5);
  if (!output) process.exit(3);
  if (scenario !== "plan_missing") {
    writeFileSync(output, scenario === "plan_empty" ? Buffer.alloc(0) : Buffer.from("synthetic-contract-plan-v1", "utf8"));
  }
  process.stdout.write("plan ok\n");
  process.exit(0);
}
if (command === "show") {
  if (scenario === "json_missing") process.exit(0);
  if (scenario === "json_empty") process.exit(0);
  if (scenario === "json_truncated") {
    process.stdout.write("{\"format_version\":");
    process.exit(0);
  }
  if (!fixturePath) process.exit(4);
  if (scenario === "summary_nonconform") {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    fixture.resource_changes[0].change.actions = ["update"];
    process.stdout.write(JSON.stringify(fixture));
    process.exit(0);
  }
  process.stdout.write(readFileSync(fixturePath, "utf8"));
  process.exit(0);
}
