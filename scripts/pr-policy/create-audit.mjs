function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const labels = required("PR_POLICY_TICKET_LABELS")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean)
  .sort();
const audit = {
  schemaVersion: 1,
  headSha: required("PR_POLICY_HEAD_SHA"),
  verifiedBy: required("PR_POLICY_VERIFIED_BY"),
  verifiedAt: required("PR_POLICY_VERIFIED_AT"),
  ticket: {
    key: required("PR_POLICY_TICKET_KEY"),
    issueType: required("PR_POLICY_TICKET_TYPE"),
    status: required("PR_POLICY_TICKET_STATUS"),
    labels,
    blocked: process.env.PR_POLICY_TICKET_BLOCKED === "true",
    scope: required("PR_POLICY_SCOPE"),
  },
};

process.stdout.write(`<!-- codex-policy-audit\n${JSON.stringify(audit)}\n-->\n`);
