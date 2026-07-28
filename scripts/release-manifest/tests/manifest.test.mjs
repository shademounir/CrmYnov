import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createManifest,
  issueIsInManifest,
  releaseEvidence,
  validateManifest,
} from "../index.mjs";

test("manifest is deterministic, sorted and deduplicated", () => {
  const manifest = createManifest({
    version: "v0.1.0",
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
      humanApproved: true,
      ciGreen: true,
      mergedToMain: true,
      tagCreated: true,
      releasePublished: true,
      listedInManifest: true,
    },
  );
});
