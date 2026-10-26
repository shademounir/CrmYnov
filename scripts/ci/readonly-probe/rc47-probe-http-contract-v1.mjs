// Candidate external executor component. Not an authorization or native qualification.
import assert from 'node:assert/strict';
const parent = 'projects/crmynov-prod-n7x4q2/locations/europe-west1';
const jobRe = new RegExp('^' + parent + '/jobs/crm-prod-rc47-readonly-probe-[a-z0-9-]+$', 'u');
const operationRe = new RegExp('^' + parent + '/operations/[a-zA-Z0-9_-]+$', 'u');
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
export function createHttpContract({ exchange }) {
    assert.equal(typeof exchange, 'function', 'explicit exchange required; no default network transport');
    async function request(resource, { method = 'GET', body, query = '' } = {}) {
        const descriptor = Object.freeze({ url: 'https://run.googleapis.com/v2/' + resource + query, method, redirect: 'error', retry: 0, timeoutMs: 15000, ...(body ? { body: JSON.stringify(body) } : {}) });
        let reply;
        try {
            reply = await exchange(descriptor);
        }
        catch {
            throw new Error('NATIVE_EXCHANGE_OUTCOME_UNKNOWN_NO_RETRY');
        }
        assert(plain(reply), 'invalid envelope');
        assert.equal(reply.status, 200, 'native non-success; never retry automatically');
        assert(plain(reply.body), 'invalid JSON response object');
        assert(Buffer.byteLength(JSON.stringify(reply.body)) <= 1048576, 'native response size bound');
        return reply.body;
    }
    return Object.freeze({
        async getJob(name) {
            assert(jobRe.test(name));
            const value = await request(name);
            assert.equal(value.name, name, 'job resource binding');
            return value;
        },
        async listExecutions(name, pageToken = '') {
            assert(jobRe.test(name));
            assert.equal(typeof pageToken, 'string');
            assert(pageToken.length <= 8192);
            const query = new URLSearchParams({ pageSize: '100', showDeleted: 'true' });
            if (pageToken) {
                query.set('pageToken', pageToken);
            }
            const value = await request(name + '/executions', { query: '?' + query.toString() });
            const executions = Object.hasOwn(value, 'executions') ? value.executions : [];
            assert(Array.isArray(executions), 'only omitted executions normalizes to empty');
            assert(executions.length <= 100);
            for (const x of executions) {
                assert(plain(x));
                assert.equal(typeof x.name, 'string');
                assert(x.name.startsWith(name + '/executions/'));
                assert.match(x.name.slice((name + '/executions/').length), /^[a-z0-9-]+$/u);
            }
            const nextPageToken = Object.hasOwn(value, 'nextPageToken') ? value.nextPageToken : '';
            assert.equal(typeof nextPageToken, 'string');
            assert(nextPageToken.length <= 8192);
            return { executions, nextPageToken };
        },
        async run(name, body) {
            assert(jobRe.test(name));
            assert(plain(body));
            assert.deepEqual(Object.keys(body), ['etag'], 'etag only; overrides and validateOnly forbidden');
            assert.equal(typeof body.etag, 'string');
            assert(body.etag.length > 0 && body.etag.length <= 256);
            const value = await request(name + ':run', { method: 'POST', body });
            assert.equal(typeof value.name, 'string');
            assert(operationRe.test(value.name), 'operation resource binding');
            return value;
        },
        async getOperation(name) {
            assert(operationRe.test(name));
            const value = await request(name);
            assert.equal(value.name, name);
            return value;
        },
        async getExecution(name) {
            assert.equal(typeof name, 'string');
            const split = name.lastIndexOf('/executions/');
            assert(split > 0 && jobRe.test(name.slice(0, split)));
            assert.match(name.slice(split + 12), /^[a-z0-9-]+$/u);
            const value = await request(name);
            assert.equal(value.name, name);
            return value;
        }
    });
}
