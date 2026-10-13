// Official API transport only. Tokens are supplied by the authenticated caller,
// never read from browser profiles, written to journals, or included in errors.
export function createOperatorTransport({ origin, sessionToken, serviceToken, fetchImpl = fetch, allowLoopback = false }) {
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
    || !(base.protocol === 'https:' || (allowLoopback && base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))) throw Error('operator_origin_invalid');
  if (typeof sessionToken !== 'string' || !sessionToken || /[\r\n]/.test(sessionToken)
    || (serviceToken !== undefined && (typeof serviceToken !== 'string' || !serviceToken || /[\r\n]/.test(serviceToken)))) throw Error('operator_auth_required');
  const id = '[a-f0-9-]{36}';
  const read = new RegExp(`^/packages/${id}(?:/rows\\?limit=100(?:&after=${id})?)?$`, 'i');
  const write = new RegExp(`^/packages/${id}/rows/${id}/decision$`, 'i');
  return async (path, init = {}) => {
    const method = init.method ?? 'GET';
    if ((method === 'GET' && (!read.test(path) || init.body !== undefined))
      || (method === 'POST' && (!write.test(path) || typeof init.body !== 'string' || Buffer.byteLength(init.body) > 65536))
      || !['GET', 'POST'].includes(method) || Object.keys(init).some(k => !['method', 'body'].includes(k))) throw Error('operator_endpoint_refused');
    const headers = { authorization: `Bearer ${sessionToken}`, accept: 'application/json' };
    if (method === 'POST') headers['content-type'] = 'application/json';
    if (serviceToken) headers['x-serverless-authorization'] = `Bearer ${serviceToken}`;
    let response;
    try { response = await fetchImpl(new URL(`/lead-import/bootstrap${path}`, base), { method, headers, body: init.body, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw Error('operator_transport_uncertain'); }
    if (!response.headers.get('content-type')?.includes('application/json')) throw Error('operator_response_invalid');
    let data;
    try { data = await response.json(); } catch { throw Error('operator_response_invalid'); }
    if (!response.ok) {
      const code = /^[a-z0-9_:-]{1,120}$/i.test(data?.code ?? '') ? data.code : 'operator_api_refused';
      throw Object.assign(Error(code), { status: response.status, code });
    }
    return data;
  };
}
