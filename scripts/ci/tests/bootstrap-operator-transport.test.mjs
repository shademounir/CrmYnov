import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createOperatorTransport } from '../bootstrap-operator-transport.mjs';
const id = '00000000-0000-4000-8000-000000000001';

test('transport confines authenticated requests to decision/inventory routes', async () => {
  const calls = [];
  const request = createOperatorTransport({ origin: 'https://api.example.invalid', sessionToken: 'synthetic', fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  } });
  await request(`/packages/${id}`);
  assert.equal(calls[0].url, `https://api.example.invalid/lead-import/bootstrap/packages/${id}`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer synthetic');
  assert.equal(calls[0].init.redirect, 'error');
  for (const path of [`/packages/${id}/confirm`, '//external.invalid', `/packages/${id}/../context`]) await assert.rejects(request(path, { method: 'POST', body: '{}' }), /endpoint_refused/);
  assert.equal(calls.length, 1);
});

test('real HTTP harness checks bearer, JSON request and refusal without leaking response text', async t => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-session');
    assert.equal(req.headers['x-serverless-authorization'], 'Bearer synthetic-service');
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'permission_denied', detail: 'must-not-appear' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = createOperatorTransport({ origin: `http://127.0.0.1:${server.address().port}`, allowLoopback: true, sessionToken: 'synthetic-session', serviceToken: 'synthetic-service' });
  await assert.rejects(request(`/packages/${id}`), error => error.status === 403 && error.message === 'permission_denied' && !JSON.stringify(error).includes('must-not-appear'));
});

test('redirects and insecure non-loopback origins never transmit credentials', async () => {
  for (const origin of ['http://example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/path']) assert.throws(() => createOperatorTransport({ origin, sessionToken: 'synthetic' }), /origin_invalid/);
  const request = createOperatorTransport({ origin: 'https://api.example.invalid', sessionToken: 'synthetic', fetchImpl: async () => { throw Error('secret transport detail'); } });
  await assert.rejects(request(`/packages/${id}`), { message: 'operator_transport_uncertain' });
});
