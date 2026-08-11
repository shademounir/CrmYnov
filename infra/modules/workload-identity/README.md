# Workload Identity module

Creates a GitHub OIDC pool/provider and grants one service account
`workloadIdentityUser`. The caller supplies a fail-closed CEL condition that
must bind repository name, numeric repository and owner IDs, branch, and GitHub
Environment.
