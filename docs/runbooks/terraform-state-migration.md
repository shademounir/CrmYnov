# Runbook — Temporary local state to GCS

## Preconditions

- the relevant bucket exists and its versioning and access controls are proven;
- the operator can read and write only the intended state perimeter;
- a protected local backup exists outside Git;
- no concurrent Terraform operation is running.

## Procedure

1. Record local state lineage, serial, resources, and a checksum without logging
   sensitive attributes.
2. Add the reviewed GCS backend configuration for one perimeter only.
3. Run backend initialization with migration in the later authorized window.
4. Pull remote state to a protected temporary location and compare lineage,
   serial, and checksum expectations.
5. Test read access through the intended impersonated identity.
6. Obtain explicit human validation.
7. Only then remove the temporary local state and protected backup according to
   the approved evidence-retention decision.

## Failure and rollback

Stop all writers, preserve both copies, restore the last verified bucket object
version if required, and reinitialize against the verified backend. Never delete
either copy while state equivalence is uncertain.
