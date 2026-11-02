// Test-only exact inverse. Never imported by an operational entry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const projection={
  "schemaVersion": 1,
  "kind": "TEST_ONLY_EXACT_PRE_SONAR_R1_BYTE_PROJECTION_V1",
  "nativeAuthority": false,
  "path": "scripts/ci/runtime-image-only/sheets-api-reader-contract-v1.mjs",
  "currentBytes": 24207,
  "currentSha256": "f4bbed67fa96059d4b0351458ba66eaab74cd95ace723abadaaff9f1aa4b145e",
  "historicalBytes": 23995,
  "historicalSha256": "afaf72194869b558c598c5e651efded2de4017d160e541884989fdfaa35f1750",
  "edits": [
    {
      "offset": 219,
      "removeBytes": 182,
      "removeSha256": "d92774ec37c66ebb567f811ce6688904bf594bc3c0d530e327ac5793546cb3c4",
      "insertUtf8": "",
      "insertBytes": 0
    },
    {
      "offset": 1889,
      "removeBytes": 103,
      "removeSha256": "c71ca917cebc68cf7adb0b787bf51c4eab6d6bfe3733681c8107923c2e17209d",
      "insertUtf8": " assert.deepEqual(Object.keys(descriptors).toSorted(),[...keys].toSorted());\n",
      "insertBytes": 77
    },
    {
      "offset": 9940,
      "removeBytes": 232,
      "removeSha256": "9e0e0736cebf04fe1483f177a1b75fc3c45dabb2f13e9f4b41267d14a79526c6",
      "insertUtf8": "const INPUTS_ADC_OVERRIDES=['CRM_GOOGLE_SHEETS_CREDENTIALS_FILE','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','GOOGLE_GHA_CREDS_PATH','GCE_METADATA_HOST','GCE_METADATA_IP','GCE_METADATA_ROOT'];\n",
      "insertBytes": 223
    },
    {
      "offset": 12974,
      "removeBytes": 94,
      "removeSha256": "7e234a17940cdb2c112216d57cdfbdd3bc09f9de8b0b7ab83329f89cb9e522e6",
      "insertUtf8": " assert(!names.some(name=>INPUTS_ADC_OVERRIDES.includes(name)),'INPUTS_ADC_OVERRIDE_NOT_ALLOWED');\n",
      "insertBytes": 99
    }
  ]
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function preSonarReaderContractBytesV1(current){
 assert(Buffer.isBuffer(current));assert.equal(current.length,projection.currentBytes);
 assert.equal(sha(current),projection.currentSha256,'EXACT_POST_SONAR_R1_BYTES_REQUIRED');
 let inverse=Buffer.from(current),limit=current.length;
 for(const edit of [...projection.edits].reverse()){
  assert(edit.offset>=0&&edit.removeBytes>=0&&edit.offset+edit.removeBytes<=limit);
  assert.equal(sha(inverse.subarray(edit.offset,edit.offset+edit.removeBytes)),edit.removeSha256);
  const inserted=Buffer.from(edit.insertUtf8);assert.equal(inserted.length,edit.insertBytes);
  inverse=Buffer.concat([inverse.subarray(0,edit.offset),inserted,inverse.subarray(edit.offset+edit.removeBytes)]);limit=edit.offset;
 }
 assert.equal(inverse.length,projection.historicalBytes);
 assert.equal(sha(inverse),projection.historicalSha256,'EXACT_PRE_SONAR_R1_BYTES_REQUIRED');return inverse;
}
