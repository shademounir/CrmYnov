import { createHash } from 'node:crypto';

// Operator-side orchestration only: the injected transport must use the ordinary
// authenticated API. No database, session synthesis or credential persistence.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const operatorHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function validateOperatorPlan(plan) {
  if (!plan || plan.schemaVersion !== 1 || !uuid.test(plan.packageId) || !sha.test(plan.excelSha256)
    || !uuid.test(plan.campusId) || !Number.isInteger(plan.packageVersion) || plan.packageVersion < 1
    || !Array.isArray(plan.rows) || plan.rows.length < 1 || plan.rows.length > 25
    || new Set(plan.rows.map(row => row.id)).size !== plan.rows.length) throw Error('operator_plan_invalid');
  for (const row of plan.rows) {
    if (!uuid.test(row.id) || !sha.test(row.fingerprint) || !Number.isInteger(row.version) || row.version < 1
      || !row.decision || !['CREATE_DOSSIER', 'DEFER'].includes(row.decision.action)
      || typeof row.decision.reason !== 'string' || row.decision.reason.trim().length < 8
      || row.decision.reason.length > 1000 || 'idempotencyKey' in row.decision || 'expectedVersion' in row.decision
      || Object.keys(row.decision).some(key => !['action', 'reason', 'overrides', 'cycle', 'annotations', 'confirmed'].includes(key))) throw Error('operator_decision_invalid');
    if (row.decision.action === 'DEFER' && (row.decision.confirmed !== true
      || Object.keys(row.decision).some(key => !['action', 'reason', 'confirmed'].includes(key)))) throw Error('operator_deferral_invalid');
    if (row.decision.action === 'CREATE_DOSSIER' && 'confirmed' in row.decision) throw Error('operator_create_invalid');
  }
  return operatorHash(plan);
}

export async function readOperatorRows(request, packageId) {
  const rows = [], seen = new Set(); let after;
  do {
    const page = await request(`/packages/${packageId}/rows?limit=100${after ? `&after=${after}` : ''}`);
    if (!Array.isArray(page.items) || page.items.length > 100 || rows.length + page.items.length > 10000) throw Error('operator_inventory_invalid');
    for (const row of page.items) { if (!uuid.test(row.id) || seen.has(row.id)) throw Error('operator_inventory_collision'); seen.add(row.id); rows.push(row); }
    if (page.nextAfter !== null && (!uuid.test(page.nextAfter) || !page.items.length || page.nextAfter !== page.items.at(-1).id || page.nextAfter === after)) throw Error('operator_cursor_invalid');
    after = page.nextAfter;
  } while (after);
  return rows;
}

/** At most 25 decisions, serially. No automatic confirmation or business effects.
 * Persist an intent BEFORE each POST. A lost response is resumed with the exact
 * same key/body and the server revalidates permissions. Never infer a receipt.
 * The caller provides an exclusive private journal lock for the whole call. */
export async function decideOperatorBlock({ plan, request, journal, persist, exclusiveLockHeld }) {
  if (exclusiveLockHeld !== true) throw Error('operator_lock_required');
  const planHash = validateOperatorPlan(plan), base = `/packages/${plan.packageId}`;
  if (journal && journal.planHash !== planHash) throw Error('operator_journal_mismatch');
  const state = structuredClone(journal ?? { planHash, decisions: {}, complete: false });
  const current = await request(base);
  if (current.id !== plan.packageId || current.sha256 !== plan.excelSha256 || current.campusId !== plan.campusId
    || current.version !== plan.packageVersion || !['MAPPED', 'PARTIAL'].includes(current.state)) throw Error('operator_package_changed');
  const rows = await readOperatorRows(request, plan.packageId), byId = new Map(rows.map(row => [row.id, row]));
  if (rows.length !== current.counts.total) throw Error('operator_inventory_incomplete');
  for (const item of plan.rows) {
    const row = byId.get(item.id);
    if (!row || row.fingerprint !== item.fingerprint) throw Error('operator_source_changed');
    // Accepted/ignored rows are NEVER replayed by this helper, including the two
    // already imported before the operator existed. They require no new decision.
    if (['ACCEPTED', 'IGNORED'].includes(row.state)) { state.decisions[item.id] = { phase: 'PRESERVED_TERMINAL', state: row.state }; await persist(state); continue; }
    const body = { ...item.decision, expectedVersion: item.version, idempotencyKey: `op-${operatorHash([planHash, item.id])}` };
    const previous = state.decisions[item.id];
    if (previous?.phase === 'REFUSED') continue;
    if (previous?.body && operatorHash(previous.body) !== operatorHash(body)) throw Error('operator_intent_changed');
    if (!previous && (row.state !== 'REVIEW' || row.version !== item.version || row.decision)) throw Error('operator_row_changed');
    state.decisions[item.id] = { phase: 'INTENT', body };
    await persist(structuredClone(state));
    try {
      const result = await request(`${base}/rows/${item.id}/decision`, { method: 'POST', body: JSON.stringify(body) });
      const expected = item.decision.action === 'DEFER' ? 'DEFERRED' : 'READY';
      if (result.id !== item.id || result.fingerprint !== item.fingerprint || result.state !== expected || result.version !== item.version + 1) throw Error('operator_decision_readback_invalid');
      state.decisions[item.id] = { phase: 'PERSISTED', body, state: result.state, version: result.version };
      await persist(structuredClone(state));
    } catch (error) {
      // Only definitive validation refusals may be recorded and skipped. Auth,
      // concurrency and uncertain transport failures stop the entire block.
      if (![400, 422].includes(error?.status)) throw error;
      state.decisions[item.id] = { phase: 'REFUSED', body, status: error.status, code: /^[a-z0-9_:-]{1,120}$/i.test(error.code ?? '') ? error.code : 'operator_validation_refused' };
      await persist(structuredClone(state));
    }
  }
  state.complete = true; await persist(structuredClone(state)); return state;
}
