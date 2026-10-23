import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
const repository = process.cwd(), root = process.env.CRMY63_SCHEMA3_PROOF_ROOT;
if (!root || process.env.DATABASE_URL)
    throw new Error("schema3_local_proof_root_required_without_database");
const gitExecutable = process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "/usr/bin/git";
if (!["win32", "linux"].includes(process.platform) || !statSync(gitExecutable).isFile())
    throw new Error("schema3_git_executable_unavailable");
const directory = mkdtempSync(join(root, "schema3-local-qualification-"));
const hash = b => createHash("sha256").update(b).digest("hex");
const snapshot = () => execFileSync(gitExecutable, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repository, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean).sort((a, b) => a.localeCompare(b, "en")).map(path => ({ path, sha256: hash(readFileSync(resolve(repository, path))) }));
const sources = snapshot(), stages = [], env = { ...process.env, CRMY63_HISTORICAL_ARTIFACT_ROOT: root };
const run = (name, cwd, args, timeout = 300000) => {
    let output, status = 0;
    try {
        output = execFileSync(process.execPath, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    }
    catch (e) {
        output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
        status = e.status ?? -1;
    }
    writeFileSync(join(directory, `${name}.log`), output, { flag: "wx" });
    stages.push({ name, status, logSha256: hash(output) });
    console.log(JSON.stringify(stages.at(-1)));
    if (status !== 0)
        throw new Error(`schema3_stage_failed:${name}`);
};
try {
    const rootTests = ["infra/tests", "scripts/bootstrap-phase0/tests", "scripts/ci/tests", "scripts/jira-sync/tests", "scripts/pr-policy/tests", "scripts/release-manifest/tests", "scripts/terraform-plan/tests"].flatMap(folder => readdirSync(join(repository, folder)).filter(p => p.endsWith(".test.mjs")).map(p => `${folder}/${p}`));
    run("repository-unit", repository, ["--test", ...rootTests]);
    run("api-types", repository, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "apps/api/tsconfig.json"]);
    run("web-types", repository, ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false", "-p", "apps/web/tsconfig.json"]);
    const api = join(repository, "apps/api"), web = join(repository, "apps/web");
    for (let i = 1; i <= 5; i++)
        run(`private-artifact-repeat-${i}`, api, ["--require", "../../node_modules/tsx/dist/cjs/index.cjs", "--test", "test/sheet-historical.test.ts"]);
    const tests = app => readdirSync(join(app, "test")).filter(p => p.endsWith(".test.ts")).sort((a, b) => a.localeCompare(b, "en")).map(p => `test/${p}`);
    run("api-unit", api, ["--require", "../../node_modules/tsx/dist/cjs/index.cjs", "--test", ...tests(api)]);
    run("web-unit", web, ["--import", "tsx", "--test", ...tests(web)]);
    if (JSON.stringify(snapshot()) !== JSON.stringify(sources))
        throw new Error("schema3_source_changed_during_qualification");
    writeFileSync(join(directory, "result.json"), `${JSON.stringify({ status: "PASSED", at: new Date().toISOString(), runtime: process.version, sourceFingerprint: hash(JSON.stringify(sources)), sources, stages, productionMutation: false, prismaGeneration: false }, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "PASSED", directory }));
}
catch (e) {
    writeFileSync(join(directory, "failure.json"), `${JSON.stringify({ status: "FAILED", at: new Date().toISOString(), error: e.message, sources, stages }, null, 2)}\n`, { flag: "wx" });
    console.error(directory);
    throw e;
}
