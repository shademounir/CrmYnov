import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createManifest,
  issueIsInManifest,
  releaseProfile,
  releaseEvidence,
  validateRequiredChecks,
  validateManifest,
} from "../index.mjs";

test("manifest is deterministic, sorted and deduplicated", () => {
  const manifest = createManifest({
    version: "v0.1.0",
    profile: "application",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-901", "CRMY-900", "CRMY-901"],
  });
  assert.deepEqual(manifest.tickets, ["CRMY-900", "CRMY-901"]);
  assert.equal(manifest.sha256.length, 64);
});

test("synthetic fixture passes integrity validation", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/release-manifest.synthetic.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(validateManifest(fixture), fixture);
});

test("tampered manifest is rejected", () => {
  const manifest = createManifest({
    version: "v0.1.0",
    profile: "application",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-900"],
  });
  assert.throws(
    () => validateManifest({ ...manifest, tickets: ["CRMY-999"] }),
    /integrity/,
  );
});

test("release evidence proves manifest membership and release PR source", () => {
  const manifest = createManifest({
    version: "v0.1.0",
    profile: "application",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-900"],
  });
  assert.equal(issueIsInManifest(manifest, "CRMY-900"), true);
  assert.deepEqual(
    releaseEvidence({
      manifest,
      issueKey: "CRMY-900",
      releaseTag: "v0.1.0",
      sourceIncludedInReleasePr: true,
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      releasePublished: true,
    }),
    {
      approvalValidated: true,
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  );
});

test("Gate-1 prerelease version and profile are accepted", () => {
  const manifest = createManifest({
    version: "v0.1.0-gate.1",
    profile: "gate-1",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-109"],
  });
  assert.equal(manifest.version, "v0.1.0-gate.1");
  assert.deepEqual(releaseProfile(manifest.profile).requiredChecks, [
    "unit-tests",
    "terraform-static",
    "iac-security",
    "secret-scan",
  ]);
});

test("application profile remains blocked by unavailable mandatory checks", () => {
  const required = releaseProfile("application").requiredChecks;
  for (const check of ["lint", "type-check", "build", "CodeQL", "SonarQube Quality Gate"]) {
    assert.ok(required.includes(check));
  }
  const gate1Only = releaseProfile("gate-1").requiredChecks.map((name, id) => ({
    id,
    name,
    status: "completed",
    conclusion: "success",
  }));
  assert.throws(
    () => validateRequiredChecks(required, gate1Only),
    (error) => error.details.missing.includes("CodeQL"),
  );
});

test("ticket absent from manifest is refused as release evidence", () => {
  const manifest = createManifest({
    version: "v0.1.0-gate.1",
    profile: "gate-1",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-109"],
  });
  assert.equal(issueIsInManifest(manifest, "CRMY-999", "Task"), false);
});

test("Epic in a release closure manifest is refused", () => {
  const manifest = createManifest({
    version: "v0.1.0-gate.1",
    profile: "gate-1",
    targetCommit: "1111111111111111111111111111111111111111",
    tickets: ["CRMY-109"],
  });
  assert.throws(
    () => issueIsInManifest(manifest, "CRMY-109", "Epic"),
    /Epic tickets are forbidden/,
  );
});
