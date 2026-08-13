#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { analyzePhase0Contract, publicFailure } from "./phase0-contract.mjs";

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("arguments_invalid");
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

const invocation = args(process.argv.slice(2));
if (invocation.mode === "Real") {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 2, valid: false, errorCode: "real_mode_disabled", mutated: false, cleanupSucceeded: true, rollbackRequired: false })}\n`);
  process.exitCode = 1;
} else {
  const lock = resolve(tmpdir(), "crmynov-phase0-code-only.lock");
  let acquired = false;
  try {
    await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    acquired = true;
    if (!invocation.fixture || !["SyntheticFixture", "ContractSimulation"].includes(invocation.mode)) {
      throw new Error("invocation_invalid");
    }
    const input = JSON.parse(await readFile(resolve(invocation.fixture), "utf8"));
    process.stdout.write(`${JSON.stringify(analyzePhase0Contract(input, { mode: invocation.mode }))}\n`);
  } catch (error) {
    const failure = error?.code === "EEXIST"
      ? { schemaVersion: 2, valid: false, errorCode: "single_attempt_violation", mutated: false, cleanupSucceeded: false, rollbackRequired: false }
      : publicFailure(error);
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  } finally {
    if (acquired) await rm(lock, { force: true });
  }
}
