// New prospective GENERAL authority boundary. Historical V3 code and claims
// remain byte-for-byte untouched. No native entry is exposed until the full
// protected V4 governance and forward integration are qualified.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {byteHash, digest} from './controlled-pool-contract-v1.mjs';
import {validateGeneralRenewalRecordV4} from '../runtime-image-only/cutover-renewal-catalogue-v1.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const privatePre = new WeakMap();

function durable(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      assert(count > 0, 'GENERAL_V4_DURABLE_WRITE');
      offset += count;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {path: file, sha256: byteHash(fs.readFileSync(file))};
}

function openGeneralOperationalEvidenceStoreV4({directory, record, beforeArm, now = Date.now}) {
  validateGeneralRenewalRecordV4(record, now());
  assert.equal(path.resolve(directory), path.resolve(record.evidenceDirectory));
  assert(path.isAbsolute(directory) && fs.realpathSync(directory) === path.resolve(directory), 'GENERAL_V4_CANONICAL_DIRECTORY');
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'GENERAL_V4_DIRECTORY_TYPE');
  assert.deepEqual(fs.readdirSync(directory), [], 'GENERAL_V4_NEW_EMPTY_DIRECTORY_REQUIRED');
  assert.equal(typeof beforeArm, 'function');
  const recordSha256 = digest(record), capabilityId = record.capabilityId;
  assert(HASH.test(recordSha256));
  const claim = path.join(directory, `prospective-${capabilityId}-CLAIM.json`);
  const entryId = `local:${randomUUID()}`;
  const prefix = path.join(directory, `prospective-${capabilityId}-${entryId.slice(6)}-`);
  let next = 0, armed = false, armingAttempted = false;
  const refs = {};
  return Object.freeze({
    isArmed: () => armed || (armingAttempted && fs.existsSync(claim)),
    references: () => structuredClone(refs),
    claimPath: claim,
    saveProof(value) {
      assert(armed && value.kind === 'VERIFIED_OPERATIONAL_GENERAL_PRE_V3');
      assert.equal(value.authorityRecordSha256, recordSha256);
      return durable(prefix + 'SOURCE-PROOF.json', value);
    },
    append(kind, value) {
      assert(/^[A-Z][A-Z0-9-]{0,63}$/u.test(kind));
      if (kind === 'PROSPECTIVE-RUN-INTENT') {
        assert(!armingAttempted, 'GENERAL_V4_SECOND_ARM_REFUSED');
        const ready = beforeArm();
        assert(ready && Object.getPrototypeOf(ready) === Object.prototype, 'GENERAL_V4_TYPED_READY_REQUIRED');
        armingAttempted = true;
        durable(claim, {schemaVersion: 4, kind: 'PERMANENT_GENERAL_OPERATIONAL_SINGLE_RUN_CLAIM_V4', capabilityId, authorityRecordSha256: recordSha256, entryId, readinessSha256: digest(ready), canRetry: false});
        armed = true;
      }
      if (armed) {
        const current = JSON.parse(fs.readFileSync(claim));
        assert.equal(current.entryId, entryId, 'GENERAL_V4_CLAIM_OWNERSHIP');
      }
      const result = durable(prefix + String(next++).padStart(4, '0') + '-' + kind + '.json', {...value, schemaVersion: 4, kind, capabilityId, authorityRecordSha256: recordSha256, entryId, canRetry: false});
      const key = {'GENERAL-SEMANTIC-FIN': 'semanticReceipt', 'VERIFIED-NEW-ENCRYPTED-OUTPUT': 'nativeCapture', 'PROSPECTIVE-PRE-FIN': 'preFin'}[kind];
      if (key) {
        assert(!refs[key], 'GENERAL_V4_PROOF_REFERENCE_DUPLICATE');
        refs[key] = result;
      }
      return result;
    },
  });
}

export function simulateGeneralEvidenceStoreV4({syntheticOnly, ...input}) {
  assert.equal(syntheticOnly, true);
  return Object.freeze({store: openGeneralOperationalEvidenceStoreV4(input), syntheticOnly: true, nativeAuthority: false});
}

function retainVerifiedGeneralPreV4(checked, sourceProofRef, capturedAt, syntheticOnly = false) {
  assert(checked && sourceProofRef && typeof capturedAt === 'string');
  const capability = Object.freeze({schemaVersion: 4, kind: 'IN_PROCESS_VERIFIED_GENERAL_PRE_CAPABILITY_V4', persistable: false, nativeAuthority: false});
  privatePre.set(capability, {checked, sourceProofRef, capturedAt, used: false, syntheticOnly});
  return capability;
}

async function consumePrivatePre(capability, consumer, syntheticOnly) {
  const state = privatePre.get(capability);
  assert(state && !state.used && state.syntheticOnly === syntheticOnly && typeof consumer === 'function', 'GENERAL_V4_PRIVATE_CAPABILITY_UNAVAILABLE');
  state.used = true;
  try {
    return await consumer({checked: state.checked, sourceProofRef: state.sourceProofRef, capturedAt: state.capturedAt});
  } finally {
    state.checked = undefined;
    privatePre.delete(capability);
  }
}

export async function withVerifiedGeneralPreV4(capability, consumer) {
  return consumePrivatePre(capability, consumer, false);
}

export async function simulateGeneralPrivateCapabilityV4({syntheticOnly, checked, sourceProofRef, capturedAt, consumer}) {
  assert.equal(syntheticOnly, true);
  const capability = retainVerifiedGeneralPreV4(checked, sourceProofRef, capturedAt, true);
  try {
    await assert.rejects(withVerifiedGeneralPreV4(capability, () => true));
    return {result: await consumePrivatePre(capability, consumer, true), syntheticOnly: true, nativeAuthority: false, publicShape: structuredClone(capability)};
  } finally {
    releaseVerifiedGeneralPreV4(capability);
  }
}

export function releaseVerifiedGeneralPreV4(capability) {
  const state = privatePre.get(capability);
  if (state) state.checked = undefined;
  privatePre.delete(capability);
}
