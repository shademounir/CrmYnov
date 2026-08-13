# API RBAC and session controls

CRMY-40 implements an application-only authorization boundary. It does not
configure Google Cloud Identity Platform, IAM, secrets, production or
infrastructure.

## Controls

- bearer tokens resolve to short-lived, server-side sessions;
- missing, expired, revoked and forged sessions fail closed with HTTP 401;
- controllers declare allowed roles and always enforce them on the API;
- resource mutations require ownership and a matching global, campus or team
  scope; denials use the same generic response to avoid IDOR disclosure;
- disabling a synthetic user is represented by immediate revocation of every
  active session;
- session creation is rate-limited per client key;
- correlation IDs remain present while credentials, tokens and user data are
  excluded from error payloads and logs.

## Local verification

Run `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`,
`npm run lint`, `npm run type-check` and `npm run build` from the repository
root. All test identities are synthetic.

## Rollback

Revert the CRMY-40 squash commit. No schema, data or external identity rollback
is required because this delivery creates neither a database migration nor an
external resource.
