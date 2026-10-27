// Pool-only observation building block. No credentials, client construction, CLI,
// job/provider calls, ledger read, baseline acceptance or activation authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const PURPOSE = 'POOL_RECONCILIATION_READ_ONLY_V1';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const utc = column => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const QUERIES = Object.freeze({
  identity: `SELECT current_database() AS database, current_user AS role, current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation, ${utc('transaction_timestamp()')} AS transaction_started_at, ${utc('clock_timestamp()')} AS observed_at`,
  configuration: 'SELECT campus_id::text, version FROM public.campus_assignment_configurations WHERE campus_id=$1::uuid LIMIT 2',
  currentPool: 'SELECT c.campus_id::text, c.version, v.rules FROM public.campus_assignment_configurations c JOIN public.campus_assignment_versions v ON v.campus_id=c.campus_id AND v.version=c.version WHERE c.campus_id=$1::uuid LIMIT 2',
  versions: `SELECT campus_id::text, version, actor_id, ${utc('created_at')} AS created_at, rules FROM public.campus_assignment_versions WHERE campus_id=$1::uuid ORDER BY version LIMIT 2`,
  audits: `SELECT id::text, campus_id, resource_type, resource_id, event_type, actor_id, actor_roles, correlation_id, idempotency_key, ${utc('occurred_at')} AS occurred_at, result, ("before" IS NULL OR "before"='null'::jsonb) AS before_is_null, (minimized_ip IS NULL AND session_id IS NULL) AS private_metadata_is_null, "after" FROM public.audit_events WHERE campus_id=$1::text AND resource_type='ASSIGNMENT_CONFIGURATION' AND event_type='CAMPUS_ASSIGNMENT_CONFIGURED' ORDER BY occurred_at, id LIMIT 2`,
  counters: 'SELECT campus_id::text, version, rule_id, user_id::text, assigned_count FROM public.campus_new_assignment_counters WHERE campus_id=$1::uuid ORDER BY version, rule_id, user_id LIMIT 9',
  references: 'SELECT id::text, kind, code, state, scope AS campaign_scope, campus_id::text AS campaign_campus_id FROM public.crm_references WHERE id=$1::uuid OR id=$2::uuid ORDER BY id LIMIT 3',
});
export const SESSION_SETTINGS = Object.freeze([
  'SET TRANSACTION READ ONLY',
  "SET LOCAL statement_timeout='3000ms'",
  "SET LOCAL lock_timeout='1000ms'",
  "SET LOCAL idle_in_transaction_session_timeout='5000ms'",
]);
const rowLimits = Object.freeze({identity: 1, configuration: 1, currentPool: 1, versions: 1, audits: 1, counters: 8, references: 2});
const tables = Object.freeze(['configuration', 'currentPool', 'versions', 'audits', 'counters', 'references']);
const hash = value => createHash('sha256').update(value).digest('hex');
export const QUERY_CONTRACT_SHA256 = hash(JSON.stringify({purpose: PURPOSE, queries: QUERIES, settings: SESSION_SETTINGS, rowLimits, tables}));

function exactKeys(value, expected, code) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, code);
  const actual = Object.keys(value);
  assert.equal(actual.length, expected.length, code);
  for (const key of expected) assert(Object.hasOwn(value, key), code);
}

export function validateCollectionRequest(request) {
  exactKeys(request, ['schemaVersion', 'purpose', 'phase', 'campusId', 'campaignId', 'queryContractSha256'], 'REQUEST_FIELDS');
  assert.equal(request.schemaVersion, 1);
  assert.equal(request.purpose, PURPOSE);
  assert(['PRE', 'POST'].includes(request.phase), 'PHASE');
  assert(typeof request.campusId === 'string' && typeof request.campaignId === 'string', 'SCOPE_TYPE');
  assert(uuid.test(request.campusId) && uuid.test(request.campaignId), 'SCOPE_UUID');
  assert.notEqual(request.campusId, request.campaignId, 'SCOPE_COLLISION');
  assert.equal(request.queryContractSha256, QUERY_CONTRACT_SHA256, 'QUERY_CONTRACT');
  return request;
}

function checkedTime(value) {
  assert.equal(typeof value, 'string', 'DB_TIME');
  assert(timestamp.test(value), 'DB_TIME');
  const millis = Date.parse(value);
  assert(Number.isFinite(millis), 'DB_TIME');
  assert.equal(new Date(millis).toISOString(), value.replace(/(\.\d{3})\d{3}Z$/u, '$1Z'), 'DB_CALENDAR');
  return millis;
}

function checkedRows(key, rows) {
  assert(Array.isArray(rows) && rows.length <= rowLimits[key], 'ROW_BOUND_' + key);
  const text = JSON.stringify(rows);
  assert(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= 131072, 'BYTE_BOUND_' + key);
  return JSON.parse(text);
}

function checkedIdentity(rows) {
  const safe = checkedRows('identity', rows);
  assert.equal(safe.length, 1, 'IDENTITY_MISSING');
  const identity = safe[0];
  exactKeys(identity, ['database', 'role', 'read_only', 'isolation', 'transaction_started_at', 'observed_at'], 'IDENTITY_FIELDS');
  assert.equal(identity.database, 'crmynov_prod', 'DATABASE');
  assert.equal(identity.role, 'crm_runtime', 'ROLE');
  assert.equal(identity.read_only, 'on', 'READ_ONLY');
  assert.equal(identity.isolation, 'repeatable read', 'ISOLATION');
  const started = checkedTime(identity.transaction_started_at);
  const observed = checkedTime(identity.observed_at);
  assert(identity.observed_at >= identity.transaction_started_at && observed - started <= 25000, 'TRANSACTION_TIME');
  return identity;
}

export async function collectPoolObservation(select, request) {
  validateCollectionRequest(request);
  assert.equal(typeof select, 'function', 'SELECT_CAPABILITY');
  const initial = checkedIdentity(await select('identity', QUERIES.identity, []));
  const snapshot = {};
  for (const key of tables) {
    const parameters = key === 'references' ? [request.campusId, request.campaignId] : [request.campusId];
    snapshot[key] = checkedRows(key, await select(key, QUERIES[key], parameters));
  }
  assert(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= 524288, 'SNAPSHOT_BYTE_BOUND');
  const final = checkedIdentity(await select('identity-final', QUERIES.identity, []));
  assert.equal(final.transaction_started_at, initial.transaction_started_at, 'TRANSACTION_CHANGED');
  assert(final.observed_at >= initial.observed_at, 'CLOCK_REVERSED');
  return {
    schemaVersion: 1, purpose: PURPOSE, phase: request.phase,
    queryContractSha256: QUERY_CONTRACT_SHA256,
    identity: {database: final.database, role: final.role, readOnly: final.read_only, isolation: final.isolation},
    transactionStartedAt: final.transaction_started_at,
    transactionCompletedAt: final.observed_at,
    snapshot,
    sourceClaimsOnly: true,
    nativeEvidenceAuthenticated: false,
    historicalRawHashRecovered: false,
    fullProductionPreflight: false,
    migrationLedgerObserved: false,
    activationAuthorized: false,
  };
}

export async function runPoolReadOnlyCollection(client, request) {
  validateCollectionRequest(request);
  assert.equal(typeof client?.$transaction, 'function', 'TRANSACTION_CAPABILITY');
  return client.$transaction(async tx => {
    assert.equal(typeof tx?.$executeRawUnsafe, 'function', 'SESSION_CAPABILITY');
    assert.equal(typeof tx?.$queryRawUnsafe, 'function', 'QUERY_CAPABILITY');
    for (const setting of SESSION_SETTINGS) await tx.$executeRawUnsafe(setting);
    return collectPoolObservation((_key, sql, parameters) => tx.$queryRawUnsafe(sql, ...parameters), request);
  }, {isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 25000});
}
