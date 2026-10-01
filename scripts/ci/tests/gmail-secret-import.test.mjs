import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Gmail IAM keys stay known before secret creation and preserve resource addresses', () => {
  const source = readFileSync(new URL('../../../infra/environments/dev/main.tf', import.meta.url), 'utf8');
  const block = source.split('resource "google_secret_manager_secret_iam_member" "gmail_invitation" {')[1]
    .split('resource "google_project_iam_member" "cloudsql" {')[0];
  const entries = [...block.matchAll(/"(crm-dev-gmail-oauth-[a-z-]+)"\s*=\s*google_secret_manager_secret\.(gmail_oauth_[a-z_]+)\.secret_id/gu)]
    .map(match => [match[1], match[2]]);
  assert.deepEqual(entries, [
    ['crm-dev-gmail-oauth-client-id', 'gmail_oauth_client_id'],
    ['crm-dev-gmail-oauth-client-secret', 'gmail_oauth_client_secret'],
    ['crm-dev-gmail-oauth-refresh-token', 'gmail_oauth_refresh_token'],
  ]);
  assert.match(block, /secret_id\s*=\s*each\.value/u);
  assert.match(block, /member\s*=\s*google_service_account\.api\.member/u);
  assert.match(block, /role\s*=\s*"roles\/secretmanager.secretAccessor"/u);
  assert.doesNotMatch(block, /toset\(/u);
});
