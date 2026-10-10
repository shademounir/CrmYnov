import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export type OwnedApiBundle = Readonly<{ directory: string; onClose: (close: () => Promise<void>) => void }>;
function canonical(path: string): string { return process.platform === "win32" ? path.toLowerCase() : path; }

export function ownedApiBundle(registerCleanup: (cleanup: () => Promise<void>) => void, retainForCoverage = Boolean(process.env.NODE_V8_COVERAGE)): OwnedApiBundle {
  const cwd = resolve(process.cwd()), cwdReal = realpathSync(cwd), parent = resolve(cwd, "dist");
  assert.equal(canonical(cwd), canonical(cwdReal), "owned_compiled_api_cwd_must_be_physical");
  if (existsSync(parent)) assert.equal(lstatSync(parent).isSymbolicLink(), false, "owned_compiled_api_parent_must_be_physical");
  mkdirSync(parent, { recursive: true });
  const parentReal = realpathSync(parent);
  assert.equal(canonical(parentReal), canonical(resolve(cwdReal, "dist")), "owned_compiled_api_parent_must_be_physical");
  const directory = mkdtempSync(resolve(parent, "crmy-compiled-api-"));
  const closeSteps: Array<() => Promise<void>> = [];
  registerCleanup(async () => {
    // Close every owned API (including its native coverage flush) before removing
    // only this fixture's compiled files. No shared dist output is removed.
    const errors: unknown[] = [];
    for (const close of closeSteps) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "owned_compiled_api_close_failed_bundle_preserved");
    // c8 remaps after this process exits. Keep both JS and external .map files
    // available to its converter; do not assume native source-map cache suffices.
    if (retainForCoverage) return;
    assert.equal(dirname(directory), parent);
    assert.match(basename(directory), /^crmy-compiled-api-[A-Za-z0-9]+$/u);
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(canonical(dirname(realpathSync(directory))), canonical(parentReal));
    rmSync(directory, { recursive: true });
  });
  return { directory, onClose: (close): void => { closeSteps.push(close); } };
}
