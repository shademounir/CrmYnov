# GitHub Codex code review: optional, not a merge prerequisite

The owner's explicit decision of 27 October 2026 removes mandatory favourable
Codex **GitHub code review**, not tool safety, access control, or technical gates.
The source document's SHA-256 and scope are recorded in the adjacent versioned
policy JSON. No bot approval, final result, cancellation, or green status is
fabricated. A missing or still-Running review is not by itself a reason to block.

## Effective mechanisms and retained controls

- The official Codex repository setting **Review code → Automatic review** was
  disabled. No manual or automatic `@codex review` request belongs to this process.
- `pr-policy` and the develop branch's required checks remain enabled. The policy
  already evaluates Jira, protected delegation, exact-SHA technical checks,
  unique decisions, labels, branch freshness and resolved conversations without
  requiring a Codex bot summary. Regression tests make that independence explicit.
- The readonly operational authority had an additional mandatory bot-summary
  check. It now obtains this policy from the **protected develop revision** and
  records optional review observations without treating them as approval.
  Source/merged-PR identity, protected grant, technical checks, delegated decision,
  actual unresolved conversations and change requests, release identity, fresh
  operational authority, single-use journals and native-output guards remain.
- Known defects must still be investigated and fixed. No unresolved thread or
  change request is silently marked resolved by changing this policy. Preserve
  known findings and their actual disposition in the factual audit/decision.
- PR248 was separately authorized without waiting for the bot. Its factual audit
  records the owner's waiver and the real Running status. This is not PROD
  acceptance. PR249 is not replayed; PR250 still needs concrete objectives.

The old RC47 sampler/executor checkouts, paths, source bytes and image pins remain
historical immutable evidence, not silently retargeted executors. The separate
pool/general/ledger extension consumes the new protected policy; it cannot run
until its own protected source and concrete catalogue are actually approved.

## Settings backup and rollback

Private receipts retain the official before/after observation and branch-rule
backup. Automatic code review changed from ON to OFF. Auto Security Review's
separate switch and its inherited **Whenever code review runs** trigger were not
changed; no independent Security Review execution is claimed.

To restore the former workflow, use a new authorized protected PR restoring the
mandatory source-bound review condition and its tests, then re-enable Automatic
review for this repository through the official settings. Do not rewrite old
receipts, change bot comments, weaken other checks, reset data, or replay a job.
Changing the workflow does not authorize any deployment or database operation.
