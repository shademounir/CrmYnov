import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../environments/prod-edge/${name}`, import.meta.url), 'utf8');
const main = read('main.tf');

test('edge is exactly bound to PROD and CRM hostname, not an arbitrary backend', () => {
  assert.match(main, /project = "crmynov-prod-n7x4q2"/);
  assert.match(main, /region\s*= "europe-west1"/);
  assert.match(main, /domain\s*= "crm\.ynov\.ma"/);
  assert.match(main, /name\s*= "crm-prod-web"/);
  assert.doesNotMatch(main, /resource "google_(?:dns_|cloud_run|sql_|secret_|service_account|project_iam|billing_)/);
  assert.doesNotMatch(main, /allUsers|crm-prod-api|random_password|secret_data/);
});

test('initial stage reserves exact DNS values without a listener or service lookup', () => {
  assert.match(main, /variable "activate_https"[\s\S]*?default\s*= false/);
  assert.match(main, /type\s*= "PER_PROJECT_RECORD"/);
  assert.match(main, /validation = google_certificate_manager_dns_authorization\.crm\.dns_resource_record\[0\]/);
  assert.match(main, /data = google_compute_global_address\.web\.address/);
  const sections = main.split(/(?=^(?:resource|data) ")/m).slice(1);
  const unconditional = sections.filter(block => !/count\s*= var\.activate_https \? 1 : 0/.test(block)).map(block => block.match(/^(?:resource|data) "([^"]+)"/)?.[1]);
  assert.deepEqual(unconditional, ['google_project_service', 'google_compute_global_address', 'google_certificate_manager_dns_authorization']);
  assert.equal((main.match(/prevent_destroy = true/g) || []).length, 2);
});

test('HTTPS-only edge preserves private API and avoids caching/token URL logs', () => {
  assert.match(main, /min_tls_version = "TLS_1_2"/);
  assert.match(main, /profile\s*= "MODERN"/);
  assert.match(main, /port_range\s*= "443"/);
  assert.match(main, /enable_cdn\s*= false/);
  assert.match(main, /log_config \{ enable = false \}/);
  assert.match(main, /network_endpoint_type = "SERVERLESS"/);
  assert.doesNotMatch(main, /port_range\s*= "80"|ssl_certificates|http_proxy|health_checks/);
});

test('state is independent and rollback never migrates the DNS zone', () => {
  assert.match(read('versions.tf'), /backend "gcs"/);
  assert.match(read('backend.hcl.example'), /prefix = "edge\/prod"/);
  assert.match(read('README.md'), /Never touch existing NS, apex, www, MX, SPF/);
});
