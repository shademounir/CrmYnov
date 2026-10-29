// Additive version: old entry, source pins, catalogues and UNKNOWN journals are untouched.
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function selectOperationalRoute(args) {
  assert(Array.isArray(args) && args.length > 0 && args.every(value => typeof value === 'string'), 'EXPLICIT_OPERATION_REQUIRED');
  if (args[0] === 'general-unknown-prepare') return 'OFFLINE_GENERAL_PREPARATION';
  if (args[0] === 'diagnostic-read-only') return 'VERSIONED_READONLY_DIAGNOSTIC';
  return 'HISTORICAL_OPERATIONAL_V2';
}

export async function runOperationalDriver(args) {
  const route = selectOperationalRoute(args);
  if (route === 'OFFLINE_GENERAL_PREPARATION') {
    return (await import('./pool-reconciliation/general-unknown-preparation-v1.mjs')).runGeneralUnknownPreparation(args.slice(1));
  }
  if (route === 'VERSIONED_READONLY_DIAGNOSTIC') {
    return (await import('./pool-reconciliation/pool-operational-driver-v2.mjs')).runReadOnlyOperationalDriver(args.slice(1));
  }
  return (await import('./operational-driver-v2.mjs')).runOperationalDriver(args);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runOperationalDriver(process.argv.slice(2));
    process.stdout.write(JSON.stringify({schemaVersion: 1, ...result, canRetry: false, nativeAcceptance: false, sheetsActivated: false}) + '\n');
  } catch (error) {
    // Preserve the historical refusal exit code; UNKNOWN is a returned outcome, not a retry signal.
    const {commandResult, diagnosticOf, diagnosticContext, sanitizedDiagnostic} = await import('./pool-reconciliation/readonly-native-diagnostics-v1.mjs');
    const now = Date.now();
    const diagnostic = diagnosticOf(error) ?? sanitizedDiagnostic(diagnosticContext({stage: 'VERIFY'}), {phase: 'VALIDATION', reason: 'VALIDATION_REFUSED', startedMs: now, endedMs: now, transportInvoked: false});
    process.stderr.write(JSON.stringify({schemaVersion: 1, ...commandResult({state: 'REFUSED', code: 'OPERATIONAL_V3_GUARD', diagnostic}), nativeAcceptance: false}) + '\n');
    process.exitCode = 1;
  }
}
