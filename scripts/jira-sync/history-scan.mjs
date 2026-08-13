import { spawnSync } from "node:child_process";

const secretPatterns = [
  {
    name: "GitHub classic token",
    regex: new RegExp(["gh", "p_[A-Za-z0-9]{20,}"].join("")),
  },
  {
    name: "GitHub fine-grained token",
    regex: new RegExp(["github_pat", "_[A-Za-z0-9_]{20,}"].join("")),
  },
  {
    name: "AWS access key",
    regex: new RegExp(["AKIA", "[0-9A-Z]{16}"].join("")),
  },
  {
    name: "private key",
    regex: new RegExp(
      ["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join(""),
    ),
  },
  {
    name: "GCP service account",
    regex: new RegExp(['"type"\\s*:\\s*"', "service_account", '"'].join("")),
  },
  {
    name: "GCP private key identifier",
    regex: new RegExp(['"private_', 'key_id"\\s*:'].join("")),
  },
];

function gitOutput(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`History scan could not read Git data (${result.status}).`);
  }
  return result.stdout;
}

const patchHistory = gitOutput([
  "log",
  "-p",
  "--all",
  "--no-ext-diff",
  "--format=",
]);
const objectNames = gitOutput(["rev-list", "--objects", "--all"]);
const findings = secretPatterns
  .filter(({ regex }) => regex.test(patchHistory))
  .map(({ name }) => name);

const forbiddenNames = objectNames
  .split(/\r?\n/)
  .map((line) => line.replace(/^[0-9a-f]{40}\s+/, ""))
  .filter((name) =>
    /(^|\/)(?:\.env(?:\..+)?|[^/]*service-account\.json|[^/]*\.(?:pem|p12|pfx))$/i.test(
      name,
    ) && !/(^|\/)\.env\.example$/i.test(name),
  );

if (findings.length > 0 || forbiddenNames.length > 0) {
  process.stderr.write(
    `${JSON.stringify({ secretTypes: findings, forbiddenPaths: forbiddenNames })}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ historyScan: "passed", secretTypes: 0, forbiddenPaths: 0 })}\n`,
);
