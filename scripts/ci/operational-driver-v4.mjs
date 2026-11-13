// Separate versioned launch path. No edit to PR282's protected v2 dispatcher.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runCutoverNativeCliV1, simulateCutoverNativeCliV1} from './runtime-image-only/cutover-native-cli-v1.mjs';

export async function runOperationalDriverV4(args) {
  if (args[0] !== 'image-only') throw new Error('CUTOVER_NATIVE_IMAGE_ONLY_REQUIRED');
  return runCutoverNativeCliV1(args.slice(1));
}

export async function simulateOperationalDriverV4({syntheticOnly, args, dependencies}) {
  if (syntheticOnly !== true || args?.[0] !== 'image-only') throw new Error('CUTOVER_NATIVE_SYNTHETIC_IMAGE_ONLY_REQUIRED');
  return simulateCutoverNativeCliV1({syntheticOnly, args: args.slice(1), dependencies});
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await runOperationalDriverV4(process.argv.slice(2))) + '\n'); }
  catch (error) {
    const code = /^[A-Z0-9_]+$/u.test(error?.message ?? '') ? error.message : 'CUTOVER_NATIVE_ENTRY_REFUSED';
    process.stderr.write(JSON.stringify({state: 'REFUSED', code, canRetry: false, sheetsActivated: false}) + '\n');
    process.exitCode = 1;
  }
}
