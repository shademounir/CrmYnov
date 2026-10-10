import { createHash } from "node:crypto";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { APPEND_MAX_BYTES, appendInvalid, readAppendBoundary, type SheetAppendBoundary } from "./sheet-append-contract.js";
import { readAppendQualification, type SheetAppendQualificationArtifact } from "./sheet-append-qualification.js";

/** Server-owned path/hash only. The HTTP caller cannot supply cells, N0, a path or
 * a new generation. No network/source read or implicit capture happens here. */
export async function privateAppendBoundary(environment: Readonly<Record<string, string | undefined>>, repositoryRoot: string): Promise<{ boundary: SheetAppendBoundary; sha256: string }> {
  const result = await privateAppendArtifact(environment.CRM_SHEET_APPEND_BOUNDARY_FILE, environment.CRM_SHEET_APPEND_BOUNDARY_SHA256, repositoryRoot);
  return { boundary: readAppendBoundary(result.raw), sha256: result.sha256 };
}
export async function privateAppendQualification(environment: Readonly<Record<string, string | undefined>>, repositoryRoot: string): Promise<{ qualification: SheetAppendQualificationArtifact; sha256: string }> {
  const result = await privateAppendArtifact(environment.CRM_SHEET_APPEND_QUALIFICATION_FILE, environment.CRM_SHEET_APPEND_QUALIFICATION_SHA256, repositoryRoot);
  return { qualification: readAppendQualification(result.raw), sha256: result.sha256 };
}
async function privateAppendArtifact(path: string | undefined, expected: string | undefined, repositoryRoot: string): Promise<{ raw: unknown; sha256: string }> {
  try {
    if (!path || !isAbsolute(path) || !expected || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error();
    const actual = await realpath(path), root = await realpath(repositoryRoot), rel = relative(root, actual);
    if (!rel || (!rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error();
    for (let current = dirname(actual); ; current = dirname(current)) {
      let git = false; try { await access(join(current, ".git")); git = true; } catch { /* Private directories normally have no Git metadata. */ }
      if (git) throw new Error();
      if (dirname(current) === current) break;
    }
    const information = await stat(actual);
    if (!information.isFile() || information.size > APPEND_MAX_BYTES) throw new Error();
    const bytes = await readFile(actual);
    if (bytes.length > APPEND_MAX_BYTES) throw new Error();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== expected) throw new Error();
    return { raw: JSON.parse(bytes.toString("utf8")) as unknown, sha256 };
  } catch { return appendInvalid("private_boundary_unavailable"); }
}
