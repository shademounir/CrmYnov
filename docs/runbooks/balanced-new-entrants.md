# Balanced random assignment — prospective policy

This source tranche adds opt-in `balanceNewEntrants:true` to a persisted
`CONTROLLED_RANDOM` campus rule. Missing/false retains the historical algorithm.
It does not enable Sheets, choose a real campaign/pool, or distribute the old portfolio.
It must not be activated until the source, UI, integration and deployment gates pass.

The fairness scope is explicitly **canonical campus + immutable configuration
version + selected rule**. A new administrative version starts a new prospective
cohort; previous counters and receipts remain available and are never reset.
Among currently eligible Commercials, select randomly among the smallest durable
new-entrant counts. With an unchanged eligible set, counts differ by at most one.
Ineligible peers receive nothing; a returning peer catches up when eligible.
Capacity is still checked against actual current load, including old dossiers;
that load is never substituted for the prospective fairness count.

Canonical creation and qualified Sheet/cutover NEW acquisitions opt in explicitly.
An old-Lead decision/assignment request cannot consume this prospective cohort.
Explicit FIXED reassignment retains its own existing permission/workflow contract.
No eligible peer leaves a durable unassigned reason and the existing new-Lead
manager notification; no round-robin fallback or retroactive redistribution.
The canonical campus lock and existing permission fence cover rule read, current
eligibility, minimum-count choice, Lead, unique event/Lead receipt and increment.
Creation replay returns its original receipt before selecting. A failed audit or
transaction rolls back the counter, assignment and receipt together. No draw is
reserved by an existing-Lead preview or a simulation.

Two additive tables retain counts and unique Lead/event receipts; there is no
backfill. The migration is not a production apply authority. Keep producers OFF
until exact-SHA review, fresh grants, publication, immutable binary qualification,
fresh backup and compatible native plan/apply/recipe. Never use an old binary that
ignores this policy as an active rollback. No restoration or historical deletion.

`GET /assignment/pool-administration?campusId=...` requires the current
`settings.campus.manage` grant, current session and canonical campus. It returns
only activated eligible Commercial IDs, current CRM labels and open-load counts,
plus this immutable configuration version's prospective counters. It is not the
administrative user directory. Unknown/ineligible former members retain their
counter without an unauthorized name lookup. The pool editor at
`/admin/assignment/pools` explicitly edits future rules and capacities; it does not
infer assignment pools from the internal-mail roster or create real references.
Current active campaign references and canonical source codes are checked server
side for new balanced routing. Every save is version-bound and audited. The UI
requires explicit acknowledgement of the new version/cohort; a conflict or lost
mutation response blocks resubmission until a read-only server refresh.
The API requires `confirmedNewCohort:true` whenever the saved rules include the
new balanced policy. The existing automation-toggle screen also explains and
requires this confirmation; a toggle must not silently restart the fairness cohort.

Qualified Sheet/cutover NEW rows that create an unassigned Lead write a minimized
notification to currently authorized activated managers in the same transaction;
source receipt replay cannot repeat it. This is not an e-mail to the prospect.

Remaining: positive/negative UI and multi-API/Sheet PostgreSQL execution evidence,
full source qualification and protected delivery, plus all independent real
Sheets source/header/547 individual-disposition/producer/alert/rehearsal gates.
Test definitions are not results; no activation or real delivery follows here.
