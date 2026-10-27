// Private snapshot transport only. Encryption is not proof of native provenance.
import assert from 'node:assert/strict';
import {createHash,createPublicKey,createPrivateKey,randomBytes,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,constants} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const H=/^[a-f0-9]{64}$/u;
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
export const OUTPUT_LIMIT=65536;
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
function exact(value,names){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype,'PLAIN_FIELDS');
  assert.deepEqual(Object.keys(value).sort(),[...names].sort(),'OUTPUT_FIELDS');
}
export function validateOutputContext(value){
  exact(value,['purpose','phase','job','execution','sourceSha256','nonce']);
  assert.equal(value.purpose,'POOL_RECONCILIATION_READ_ONLY_V1');
  assert(['PRE','POST'].includes(value.phase));
  assert.equal(typeof value.job,'string');assert(value.job.startsWith(ROOT));
  assert(/^crm-prod-pool-reconcile-[a-z0-9-]+$/u.test(value.job.slice(ROOT.length)));
  const prefix=value.job+'/executions/';assert.equal(typeof value.execution,'string');
  assert(value.execution.startsWith(prefix));assert(/^[a-z0-9-]+$/u.test(value.execution.slice(prefix.length)));
  for(const name of ['sourceSha256','nonce'])assert(H.test(value[name]??''));
  return value;
}
export function publicKeyFingerprint(pem){
  const key=createPublicKey(pem);assert.equal(key.asymmetricKeyType,'rsa');
  assert([3072,4096].includes(key.asymmetricKeyDetails.modulusLength),'RSA_SIZE');
  return hashBytes(key.export({type:'spki',format:'der'}));
}
function contextBytes(context){return Buffer.from(JSON.stringify(validateOutputContext(context),Object.keys(context).sort()));}
function decode(text,max){
  assert.equal(typeof text,'string');assert(text.length>0&&text.length<=max,'ENCODED_BOUND');
  const bytes=Buffer.from(text,'base64');assert.equal(bytes.toString('base64'),text,'CANONICAL_BASE64');return bytes;
}
export function sealPoolOutput(value,{publicKeyPem,context}){
  const aad=contextBytes(context),keySha256=publicKeyFingerprint(publicKeyPem);
  const raw=Buffer.from(JSON.stringify(value));assert(raw.length<=600000,'PLAINTEXT_BOUND');
  const compressed=gzipSync(raw,{level:9});assert(compressed.length<=32768,'COMPRESSED_BOUND');
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);const ciphertext=Buffer.concat([cipher.update(compressed),cipher.final()]);
  const encryptedKey=publicEncrypt({key:publicKeyPem,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key);
  key.fill(0);
  const record={schemaVersion:1,kind:'SEALED_POOL_OUTPUT_V1',context:structuredClone(context),keySha256,encryptedKey:encryptedKey.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  assert(Buffer.byteLength(JSON.stringify(record))<=OUTPUT_LIMIT,'SEALED_OUTPUT_BOUND');return record;
}
export function openSealedPoolOutput(record,{privateKeyPem,context}){
  exact(record,['schemaVersion','kind','context','keySha256','encryptedKey','iv','tag','ciphertext']);
  assert.equal(record.schemaVersion,1);assert.equal(record.kind,'SEALED_POOL_OUTPUT_V1');
  assert(Buffer.byteLength(JSON.stringify(record))<=OUTPUT_LIMIT,'SEALED_OUTPUT_BOUND');
  validateOutputContext(context);assert.deepEqual(record.context,context,'REVIEWED_CONTEXT');
  const privateKey=createPrivateKey(privateKeyPem),publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'});
  assert.equal(record.keySha256,publicKeyFingerprint(publicKey),'OUTPUT_KEY_BINDING');
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},decode(record.encryptedKey,684));
  assert.equal(key.length,32);const iv=decode(record.iv,16),tag=decode(record.tag,24);
  assert.equal(iv.length,12);assert.equal(tag.length,16);
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(contextBytes(context));decipher.setAuthTag(tag);
    const raw=Buffer.concat([decipher.update(decode(record.ciphertext,43692)),decipher.final()]);
    return JSON.parse(gunzipSync(raw,{maxOutputLength:600000}).toString('utf8'));
  }finally{key.fill(0);}
}
