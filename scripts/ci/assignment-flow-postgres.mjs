import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";

// Never reuse a recipe/DEV URL, volume, account or fixture. This proof creates
// only its own nonce-bound, loopback-only database and retains its container.
if (process.env.DATABASE_URL) throw new Error("assignment_must_not_inherit_database");
const nonce = randomUUID(), container = `crmy94-ci-${nonce}`;
const dockerExecutable = process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker";
if (!["win32", "linux"].includes(process.platform) || !statSync(dockerExecutable).isFile()) throw new Error("assignment_docker_unsupported");
accessSync(dockerExecutable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
const docker = args => execFileSync(dockerExecutable, args, { encoding: "utf8", windowsHide: true, timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
const database = "crmy94_assignment_synthetic";
let created = false;
await withPreservedCleanup(async () => {
  if (docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"] ).trim()) throw new Error("assignment_container_name_occupied");
  const image = docker(["image", "inspect", "postgres:17.6-bookworm", "--format", "{{.Id}}"] ).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw new Error("assignment_postgres_image_unverified");
  docker(["run", "-d", "--name", container, "--label", `crmy94-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true;
  await waitForPostgres(container, docker);
  const binding = docker(["port", container, "5432/tcp"] ).trim();
  if (!/^127\.0\.0\.1:\d+$/u.test(binding)) throw new Error("assignment_port_invalid");
  const info = JSON.parse(docker(["inspect", container]))[0];
  if (info.Config.Labels["crmy94-test-nonce"] !== nonce || info.Image !== image || info.NetworkSettings.Ports["5432/tcp"]?.length !== 1 || info.NetworkSettings.Ports["5432/tcp"][0].HostIp !== "127.0.0.1") throw new Error("assignment_owned_container_invalid");
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c", `CREATE SCHEMA crmy94_test_identity; CREATE TABLE crmy94_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy94_test_identity.marker VALUES ('${nonce}');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("assignment_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY94_EPHEMERAL_TEST: "true", CRMY94_DATABASE_NONCE: nonce, CRM_BACKGROUND_WORKERS: "external", SHEETS_ENABLED: "false" };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env, stdio: "inherit", windowsHide: true, timeout: 120_000 });
  execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", "test/assignment-flow-postgres.test.ts"], { cwd: "apps/api", env, stdio: "inherit", windowsHide: true, timeout: 240_000 });
}, () => {
  if (created) {
    const info = JSON.parse(docker(["inspect", container]))[0];
    if (info.Config.Labels["crmy94-test-nonce"] !== nonce) throw new Error("assignment_container_identity_mismatch");
    docker(["stop", "--timeout", "60", container]);
    console.log(JSON.stringify({ proof: "assignment-isolated-postgres", container, preserved: true, tmpfsDatabaseNotABackup: true }));
  }
});
