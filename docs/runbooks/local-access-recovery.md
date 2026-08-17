# Local access recovery — CRMY-125

## Scope

The local vertical slice exposes a web request form and provider-neutral API.
Known and unknown synthetic identities receive the same public response. The
local adapter keeps only SHA-256 digests of single-use challenges and synthetic
credentials; raw tokens, links and submitted identifiers are not logged.

The only accepted completion path is `/access-recovery/complete`. Challenges
expire after 15 minutes, are single-use and cannot be replayed with another
return path. Requests are rate-limited by the existing in-memory local limiter.

## Local verification

Start the documented local stack, open `/access-recovery`, and use only values
under the reserved `example.invalid` domain. The frontend calls the local API at
`http://localhost:3001`. Automated tests cover account non-enumeration,
expiration, replay, return-path substitution, rate limiting, OpenAPI and
correlation identifiers.

## Frozen cloud activation

This delivery does not enable or configure Google Cloud Identity Platform. A
future, separately authorized task must provide the production identity adapter,
authorized domains and redirect URIs, email templates and delivery, runtime
identity, secret handling, monitoring and non-production validation. No GCP API,
IAM grant, Secret Manager value, Terraform operation or production resource is
part of CRMY-125.

## Rollback

Revert the application squash through a protected pull request. The local store
is process-memory only, so rollback has no database or cloud migration to undo.
