import { sqlStatements, tableDefinitionParts } from "./migration-grammar.mjs";

// One bounded transition fence, not a general PL/pgSQL / trigger allowlist.
// No identifiers, expressions, exception codes or transition predicates are
// supplied by migration evidence. Every body token (including literals) matters.
export const protectiveJournalBody = `
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'business_mail_journal_delete_forbidden' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SENDING' THEN
      RAISE EXCEPTION 'business_mail_journal_initial_state_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF ROW(NEW.key,NEW.event_type,NEW.resource_id,NEW.template_version,NEW.fingerprint,NEW.recipient_user_ids,NEW.sending_token,NEW.created_at,NEW.sending_at)
    IS DISTINCT FROM ROW(OLD.key,OLD.event_type,OLD.resource_id,OLD.template_version,OLD.fingerprint,OLD.recipient_user_ids,OLD.sending_token,OLD.created_at,OLD.sending_at)
    OR OLD.status <> 'SENDING' OR NEW.status NOT IN ('ACCEPTED','UNCERTAIN') THEN
    RAISE EXCEPTION 'business_mail_journal_transition_forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
`;
const columns = ["key", "event_type", "resource_id", "template_version", "fingerprint", "recipient_user_ids", "status", "sending_token", "created_at", "sending_at", "accepted_at", "uncertain_at", "provider_message_id", "uncertainty_code"].sort((left, right) => left.localeCompare(right, "en"));
const word = (t, value) => t?.kind === "word" && t.value.toUpperCase() === value;
const id = t => t?.kind === "identifier" || t?.kind === "word";
const name = t => id(t) && /^[a-z][a-z0-9_]{0,62}$/u.test(t.value) ? t.value : undefined;
const signature = tokens => JSON.stringify(tokens.map(t => ({ kind: t.kind, value: t.kind === "word" ? t.value.toUpperCase() : t.value })));
const bodySignature = source => JSON.stringify(sqlStatements(source).map(signature));
const expectedBody = bodySignature(protectiveJournalBody);
const quote = s => `"${s}"`;
const equalSql = (tokens, source) => signature(tokens) === signature(sqlStatements(source)[0]);

function journalTables(items) {
  return items.filter(tokens => word(tokens[0], "CREATE") && word(tokens[1], "TABLE") && name(tokens[2]))
    .filter(tokens => {
      const parts = tableDefinitionParts(tokens);
      const names = parts.filter(part => !word(part[0], "CONSTRAINT")).map(part => name(part[0])).sort((left, right) => String(left).localeCompare(String(right), "en"));
      return JSON.stringify(names) === JSON.stringify(columns);
    });
}

/** Only a complete CREATE FUNCTION + BEFORE row fence + BEFORE TRUNCATE fence
 * on a journal table CREATED IN THIS MIGRATION can contribute allowed statements.
 * CREATE OR REPLACE, existing tables, SECURITY DEFINER, dynamic SQL, body changes,
 * omitted/wrong triggers and all unrecognized statements remain rejected. */
export function recognizedProtectiveJournalPlan(items) {
  const recognized = new Set(), recognizedTables = new Set(), tables = journalTables(items);
  for (const fn of items) {
    const functionName = name(fn[2]);
    if (!functionName || fn.length !== 11 || fn[10]?.kind !== "body") continue;
    if (!equalSql(fn.slice(0, 10), `CREATE FUNCTION ${quote(functionName)}() RETURNS TRIGGER LANGUAGE plpgsql AS`)) continue;
    let matches = false;
    try { matches = bodySignature(fn[10].value) === expectedBody; } catch { /* fail closed */ }
    if (!matches) continue;
    for (const tableTokens of tables) {
      const table = name(tableTokens[2]);
      const rows = items.filter(tokens => {
        const trigger = name(tokens[2]);
        return trigger && equalSql(tokens, `CREATE TRIGGER ${quote(trigger)} BEFORE INSERT OR UPDATE OR DELETE ON ${quote(table)} FOR EACH ROW EXECUTE FUNCTION ${quote(functionName)}()`);
      });
      const truncates = items.filter(tokens => {
        const trigger = name(tokens[2]);
        return trigger && equalSql(tokens, `CREATE TRIGGER ${quote(trigger)} BEFORE TRUNCATE ON ${quote(table)} FOR EACH STATEMENT EXECUTE FUNCTION ${quote(functionName)}()`);
      });
      if (rows.length !== 1 || truncates.length !== 1 || name(rows[0][2]) === name(truncates[0][2])) continue;
      recognized.add(fn); recognized.add(rows[0]); recognized.add(truncates[0]);
      recognizedTables.add(tableTokens);
    }
  }
  return { statements: recognized, tables: recognizedTables };
}

export function recognizedProtectiveJournalStatements(items) { return recognizedProtectiveJournalPlan(items).statements; }
