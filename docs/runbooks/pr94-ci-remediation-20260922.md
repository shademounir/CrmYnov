# PR94 — CI remediation, 22 September 2026

Baseline SHA: `de0c7b81a2976661822e7cd28290f94212d47af8`.
Application run: `35713396209`; policy run: `35713396131`.

## Findings and fixes

- Reporting browser fixture omitted the shared shell's new Notifications request,
  producing eight HTTP 503 console errors. Complete that fixture with an explicit
  empty notification response. Keep the zero-console-error assertion unchanged.
- Coverage failed before Sonar analysis: a Unix-socket readiness probe accepted
  PostgreSQL's temporary init server, which then stopped before schema creation.
  Require `SELECT 1` over loopback TCP, which the image's temporary init server
  does not expose. Use TCP for subsequent database creation too. Retry only the
  read-only probe, with a bounded deadline; never retry schema writes blindly.
- The aggregate quality gate simply reported those failures. No workflow,
  coverage filter, security rule, quality threshold or exemption was changed.
- Policy lacked a SHA-bound Jira audit. A fresh read found CRMY-165 without
  `codex-ready`, and still blocked by CRMY-164 (To Do). The renewed audit must
  retain those facts, not fabricate readiness or remove dependencies.

## Local verification

- 17 CI helper tests passed, including TCP probe retry and bounded failure tests.
- Real fresh isolated PostgreSQL 17.6 container: TCP query succeeded; container
  `crmy94-readiness-proof-20260922` stopped gracefully afterwards and retained.
- Three Reporting browser tests passed with the existing console assertion.
  Local server used Webpack because Turbopack rejects the existing external
  node_modules junction. Initial cold compilation exceeded the unchanged test
  timeout; the subsequent warmed run passed all three. Linux CI remains decisive.
- Repository module/JSON lint and `git diff --check` passed.

These are local proofs, not a substitute for new-SHA CI or Sonar analysis.
The full CI suite, scans and Sonar must run after publication. PR remains
Draft/manual-po. No human approval, label, Jira transition, merge or deployment.
PR93's squash and the separate PR95 worktree are preserved.

## Follow-up after the first remote rerun

At `0c862d50cee87507a077292627dbcf4367ed31f4`, Playwright and LCOV generation
passed remotely. Sonar actually analyzed this SHA and reported new-code coverage
74.9% against the unchanged 80% requirement; all other gate conditions passed.
The Notifications PostgreSQL scenario was not invoked by the coverage runner.
Invoke it explicitly on the isolated, nonce-verified coverage database, and
extend its assertions to cover read replay, owned-resource access and refusal,
fingerprint conflicts, bulk read isolation and unique audit after replay.
The extended scenario passed on the isolated populated copy (one test, no skip),
and the 17 CI helper tests passed again. No production database mutation or
coverage exclusion is needed. New-SHA Sonar confirmation remains required.

Policy run `35714893309` now accepts the audit and refuses with
`jira_codex_ready_missing`. The unresolved dependency and manual PO prerequisites
remain visible; no governance state was changed.
