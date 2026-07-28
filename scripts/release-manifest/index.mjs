import { createHash } from "node:crypto";

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function normalizedTickets(tickets, projectKey) {
  const escapedProject = projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedProject}-\\d+$`);
  const values = [...new Set(tickets.map((ticket) => ticket.trim().toUpperCase()))]
    .filter(Boolean)
    .sort();
  if (values.length === 0 || values.some((ticket) => !pattern.test(ticket))) {
    throw new Error(`Manifest tickets must use ${projectKey}-<number>.`);
  }
  return values;
}

export function manifestDigest(manifest) {
  const canonical = JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    targetCommit: manifest.targetCommit,
    projectKey: manifest.projectKey,
    tickets: manifest.tickets,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createManifest({
  version,
  targetCommit,
  tickets,
  projectKey = "CRMY",
}) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("Release version must be a semantic version.");
  }
  if (!SHA_PATTERN.test(targetCommit)) {
    throw new Error("Release target must be a full 40-character commit SHA.");
  }

  const manifest = {
    schemaVersion: 1,
    version,
    targetCommit: targetCommit.toLowerCase(),
    projectKey,
    tickets: normalizedTickets(tickets, projectKey),
  };
  return { ...manifest, sha256: manifestDigest(manifest) };
}

export function validateManifest(manifest) {
  const rebuilt = createManifest({
    version: manifest.version,
    targetCommit: manifest.targetCommit,
    projectKey: manifest.projectKey,
    tickets: manifest.tickets,
  });
  if (manifest.schemaVersion !== 1 || manifest.sha256 !== rebuilt.sha256) {
    throw new Error("Release manifest integrity check failed.");
  }
  return rebuilt;
}

export function issueIsInManifest(manifest, issueKey) {
  return validateManifest(manifest).tickets.includes(issueKey);
}

export function releaseEvidence({
  manifest,
  issueKey,
  releaseTag,
  sourceIncludedInReleasePr,
  humanApproved,
  ciGreen,
  mergedToMain,
  releasePublished,
}) {
  const validManifest = validateManifest(manifest);
  return {
    humanApproved: humanApproved === true,
    ciGreen: ciGreen === true,
    mergedToMain: mergedToMain === true,
    tagCreated:
      releaseTag === validManifest.version &&
      sourceIncludedInReleasePr === true,
    releasePublished: releasePublished === true,
    listedInManifest: validManifest.tickets.includes(issueKey),
  };
}
