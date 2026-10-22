// Server-only, pinned private artifacts. No source fetch or activation.
import { createHash } from 'node:crypto';
import { access, lstat, open, realpath } from 'node:fs/promises';
export interface ArtifactIO { access: typeof access; lstat: typeof lstat; open: typeof open; realpath: typeof realpath }
const nativeIO: ArtifactIO = { access, lstat, open, realpath };
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export class HistoricalArtifactError extends Error {
  readonly code: string;
  constructor(code = 'historical_private_artifact_unavailable') { super(code); this.name = 'HistoricalArtifactError'; this.code = code; }
}
export interface PrivateArtifact { readonly raw: unknown; readonly bytes: Buffer; readonly sha256: string }
export interface ServerArtifactBinding { readonly path: string | undefined; readonly sha256: string | undefined; readonly maxBytes: number }
export const artifactSha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function inside(root: string, target: string): boolean {
  const rel = relative(root, target); return !rel || !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function assertNoGitAncestor(file: string, io: ArtifactIO): Promise<void> {
  for (let current = dirname(file), depth = 0; ; current = dirname(current), depth++) {
    if (depth > 128) throw new HistoricalArtifactError();
    let found = false; try { await io.access(join(current, '.git')); found = true; } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw new HistoricalArtifactError(); }
    if (found) throw new HistoricalArtifactError();
    if (dirname(current) === current) return;
  }
}
/** Bindings come exclusively from server configuration, never an HTTP request.
 * Reads use one descriptor and a maxBytes+1 budget, not an unbounded readFile. */
export async function readPinnedPrivateArtifact(binding: ServerArtifactBinding, repositoryRoot: string, io: ArtifactIO = nativeIO): Promise<PrivateArtifact> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let result: PrivateArtifact | undefined, failed = false;
  try {
    if (!binding.path || !isAbsolute(binding.path) || /^(?:\\\\|\/\/)/u.test(binding.path) || !binding.sha256 || !/^[a-f0-9]{64}$/u.test(binding.sha256)
      || !Number.isSafeInteger(binding.maxBytes) || binding.maxBytes < 1 || binding.maxBytes > 4 * 1024 * 1024 || !isAbsolute(repositoryRoot) || /^(?:\\\\|\/\/)/u.test(repositoryRoot)) throw new HistoricalArtifactError();
    const initial = await io.lstat(binding.path, { bigint: true });
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1n || initial.size > BigInt(binding.maxBytes)) throw new HistoricalArtifactError();
    const [actual, root] = await Promise.all([io.realpath(binding.path), io.realpath(repositoryRoot)]);
    if (inside(root, actual)) throw new HistoricalArtifactError();
    await assertNoGitAncestor(binding.path, io); await assertNoGitAncestor(actual, io);
    handle = await io.open(actual, 'r');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(binding.maxBytes) || initial.dev !== before.dev || initial.ino !== before.ino) throw new HistoricalArtifactError();
    const buffer = Buffer.alloc(binding.maxBytes + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, Math.min(65536, buffer.length - total), total);
      if (!bytesRead) break; total += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || total > binding.maxBytes || BigInt(total) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new HistoricalArtifactError();
    const bytes = Buffer.from(buffer.subarray(0, total)), sha256 = artifactSha256(bytes);
    if (sha256 !== binding.sha256) throw new HistoricalArtifactError();
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new HistoricalArtifactError();
    await assertNoGitAncestor(binding.path, io); await assertNoGitAncestor(actual, io);
    const finalPath = await io.lstat(binding.path, { bigint: true });
    if (!finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.nlink !== 1n || finalPath.dev !== before.dev || finalPath.ino !== before.ino || await io.realpath(binding.path) !== actual) throw new HistoricalArtifactError();
    result = { raw: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, bytes, sha256 };
  } catch { failed = true; }
  finally { try { await handle?.close(); } catch { failed = true; } }
  if (failed || !result) throw new HistoricalArtifactError();
  return result;
}
