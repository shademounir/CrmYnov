// Exact test-only Git blobs from PR282; never imported by an operational path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../../../',import.meta.url);
const raw=fs.readFileSync(new URL('scripts/ci/runtime-image-only/fixtures/pre-post-metadata-pr282.json',root));
assert.equal(sha(raw),'1cf380775af5b69dc3d9bbdf92b4defb84394915708c2f1aac12c355c51a6c82');
const data=JSON.parse(raw);
assert.equal(data.kind,'TEST_ONLY_IMMUTABLE_PR282_PREIMAGES');
assert.equal(data.commit,'c4dfed68baa4b750256285032761f0f09aea5a8e');
const frozen=new Map(data.files.map(row=>{
 const bytes=Buffer.from(row.sourceUtf8,'utf8');assert.equal(sha(bytes),row.sha256,row.path);return [row.path,bytes];
}));
assert.equal(frozen.size,5);
export function readPr282ProtectedBytes(relative){
 const bytes=frozen.get(relative);
 return bytes?Buffer.from(bytes):fs.readFileSync(new URL(relative,root));
}
