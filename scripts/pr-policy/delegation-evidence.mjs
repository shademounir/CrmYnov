import { GRANT_PATH, grantDigest } from "./delegation.mjs";

export async function loadProtectedDelegation({ repository, headSha, token, requireAncestor = true, fetchImpl = globalThis.fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !/^[a-f0-9]{40}$/.test(headSha ?? "")) {
    throw new Error("Invalid immutable delegation evidence reference.");
  }
  if (!token) throw new Error("GitHub token required for delegation evidence.");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  async function request(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, { headers });
    if (!response.ok) throw new Error(`Protected delegation evidence unavailable (${response.status}); bootstrap requires existing policy.`);
    return response.json();
  }
  const protectedSha = (await request("branches/develop")).commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(protectedSha ?? "")) throw new Error("Invalid protected delegation revision.");
  if (requireAncestor) {
    const comparison = await request(`compare/${protectedSha}...${headSha}`);
    if (comparison.merge_base_commit?.sha !== protectedSha || !["ahead", "identical"].includes(comparison.status)) {
      throw new Error("Protected delegation revision not included in reviewed head.");
    }
  }
  async function grantAt(sha) {
    const result = await request(`contents/${GRANT_PATH}?ref=${sha}`);
    if (result.encoding !== "base64" || typeof result.content !== "string" || result.content.length > 32_768) {
      throw new Error("Invalid protected delegation content.");
    }
    return JSON.parse(Buffer.from(result.content, "base64").toString("utf8"));
  }
  const [trustedGrant, headGrant] = await Promise.all([grantAt(protectedSha), grantAt(headSha)]);
  return { trustedGrant, headGrantDigest: grantDigest(headGrant), authorityRevision: protectedSha };
}
