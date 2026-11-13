# CRMY-28 — independent PROD HTTPS edge

Only crmynov-prod-n7x4q2, crm.ynov.ma, europe-west1 Web backend.
No domain registration, DNS managed zone, DNS records, NS migration, mail,
IAM, API service, database or runtime-state changes belong to this root.
The existing protected PROD state bucket is reused with distinct `edge/prod`
prefix after verifying owner/access/versioning; never migrate runtime/prod.
Saved plans/state remain private. No local-state apply.

## Staged application

Default `activate_https=false` creates three resources only: Certificate
Manager API activation (not disabled on destroy), a protected global public
IPv4 and a protected PER_PROJECT_RECORD certificate DNS authorization.
It does not claim a certificate is issued, expose a backend or change DNS.
Review the exact plan and expected project before applying the saved plan.
Export only `dns_records` for the external DNS operator, never raw state.

Set `activate_https=true` in a later reviewed plan after crm-prod-web exists
with qualified compatible images, authenticated business routes, correct
origin/cookies/CSRF and private API IAM. The edge reads, never owns, that service.
It adds a serverless NEG, backend, URL map, TLS 1.2+ MODERN policy, managed
certificate/map/entry, HTTPS proxy and port 443 forwarding rule. No HTTP port,
CDN cache, API NEG or public API binding is created. URL access logging is OFF
to avoid recording activation token URLs; runtime operational monitoring stays.
DNS validation can precede this step; do not publish A before ready backend.

No activation is implied by a Terraform success. Verify certificate ACTIVE,
DNS through both authoritative servers, HTTPS without warnings, session and
mutation guards, first-access links and the untouched apex/www/MX/SPF.
Keep native run.app available during the qualified transition. Application
origin support is a separate runtime/code change, not silently bypassed here.

## Cost and rollback

Indicative pricing checked 12 October 2026, USD, 730 hours/month:
- HTTPS forwarding-rule tier: 0.025/hour, about 18.25/month once activated.
- Data processing: about 0.008/GiB each direction, plus Internet egress.
- Certificate Manager first 100 certificates/project are free at published
  rates; verify applicable SKU/account pricing at execution time.
- Reserved unused IPv4: 0.01/hour, about 7.30/month while awaiting DNS/backend;
  address attached to a forwarding rule is not separately charged. This is not
  a zero-cost preparation step. Charges are not additive for an address that
  is no longer unused; the active forwarding-rule tier replaces this line.
Maintain the existing USD150 total PROD budget/alerts, not a new USD150 edge
budget and not a spending cap. Review runtime + edge + storage/build/egress
estimate before apply; no budget increase is implied by this source.

Pricing: https://cloud.google.com/load-balancing/pricing
https://cloud.google.com/vpc/network-pricing#ipaddress
https://cloud.google.com/certificate-manager/pricing

DNS rollback removes only newly created CRM A and authorization CNAME whose
exact name/type/value and provider ID were recorded before/after creation.
Never touch existing NS, apex, www, MX, SPF or unrelated verification records.
Removing authorization prevents future certificate renewal; coordinate with
the application rollback. No data restoration is involved. Address and DNS
authorization have prevent_destroy; infrastructure removal requires a separate
review, not an automatic destroy. Do not turn activation off casually after use.
