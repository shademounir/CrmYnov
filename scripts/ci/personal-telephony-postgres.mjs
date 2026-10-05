import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";

if (process.env.DATABASE_URL) throw new Error("personal_telephony_must_not_inherit_database");
const nonce = randomUUID(), container = `crmy176-ci-${nonce}`;
const dockerExecutable = process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker";
if (!["win32", "linux"].includes(process.platform) || !statSync(dockerExecutable).isFile()) throw new Error("personal_telephony_docker_unsupported");
accessSync(dockerExecutable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
const docker = args => execFileSync(dockerExecutable, args, { encoding: "utf8", windowsHide: true, timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
let created = false;
await withPreservedCleanup(async () => {
  docker(["run", "-d", "--name", container, "--label", `crmy176-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=crmy171_synthetic", "postgres:17.6-bookworm"]);
  created = true;
  await waitForPostgres(container, docker);
  const binding = docker(["port", container, "5432/tcp"]).trim();
  if (!/^127\.0\.0\.1:\d+$/u.test(binding)) throw new Error("personal_telephony_port_invalid");
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "crmy171_synthetic", "-v", "ON_ERROR_STOP=1", "-c", `CREATE SCHEMA crmy171_test_identity; CREATE TABLE crmy171_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy171_test_identity.marker VALUES ('${nonce}');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "crmy171_synthetic", "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("personal_telephony_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/crmy171_synthetic`, CRMY176_EPHEMERAL_TEST: "true", CRMY171_DATABASE_NONCE: nonce, SHEETS_ENABLED: "false" };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env, stdio: "inherit", windowsHide: true, timeout: 120_000 });
  execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", "test/telephony-own-http-postgres.test.ts", "test/telephony-own-concurrency-postgres.test.ts"], { cwd: "apps/api", env, stdio: "inherit", windowsHide: true, timeout: 240_000 });
}, () => {
  if (created) {
    // Retain this newly owned test container and its evidence, never remove an
    // existing user's volume or interrupt an unrelated database.
    const info = JSON.parse(docker(["inspect", container]))[0];
    if (info.Config.Labels["crmy176-test-nonce"] !== nonce) throw new Error("personal_telephony_container_identity_mismatch");
    docker(["stop", "--timeout", "60", container]);
    console.log(JSON.stringify({ proof: "personal-telephony-isolated-postgres", container, preserved: true }));
  }
});
