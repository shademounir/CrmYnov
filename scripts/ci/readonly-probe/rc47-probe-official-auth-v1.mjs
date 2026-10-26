// Official authentication only. Tokens/configuration values are never logged or persisted.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const EMPTY_AUTH = ['ACCESS_TOKEN', 'ACCESS_TOKEN_FILE', 'CREDENTIAL_FILE_OVERRIDE', 'IMPERSONATE_SERVICE_ACCOUNT', 'LOGIN_CONFIG_FILE', 'TOKEN_HOST'];
const absent = value => value === null || value === undefined || value === '';
function rejectAmbient(environment) {
    for (const [key, value] of Object.entries(environment)) {
        if ((key.toUpperCase().startsWith('CLOUDSDK_AUTH_') || key.toUpperCase() === 'GOOGLE_APPLICATION_CREDENTIALS') && !absent(value)) {
            throw Error('AMBIENT_AUTH_OVERRIDE_REFUSED');
        }
    }
}
function checkAuthConfiguration(stdout) {
    assert.equal(typeof stdout, 'string');
    assert(Buffer.byteLength(stdout) <= 16384);
    const value = JSON.parse(stdout);
    assert(value && typeof value === 'object' && !Array.isArray(value));
    const auth = value.auth ?? {};
    assert(auth && typeof auth === 'object' && !Array.isArray(auth));
    for (const [key, setting] of Object.entries(auth)) {
        const disabledFlag = key === 'disable_credentials' && (setting === false || setting === 'false' || setting === 'False');
        assert(absent(setting) || disabledFlag, 'ambient authentication configuration refused');
    }
}
export function createOfficialAccessToken({ account, gcloudPath, pythonPath, execute = run, environment = process.env }) {
    assert.equal(typeof account, 'string');
    assert.match(account, /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+$/u);
    assert.equal(gcloudPath.split(path.win32.sep).join('/'), 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py');
    assert.equal(pythonPath.split(path.win32.sep).join('/'), 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe');
    assert(path.win32.isAbsolute(gcloudPath));
    assert.equal(typeof execute, 'function');
    return async ({ signal } = {}) => {
        assert(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        try {
            const incoming = { ...environment };
            rejectAmbient(incoming);
            const baseEnv = { ...incoming, PYTHONHOME:'', PYTHONPATH:'', CLOUDSDK_CORE_DISABLE_PROMPTS: '1', CLOUDSDK_CORE_DISABLE_FILE_LOGGING: '1' };
            const invoke = (args, env, timeout) => {
                assert.equal(signal.aborted, false);
                return execute(pythonPath, ['-I', gcloudPath, ...args], { signal, timeout, maxBuffer: 16384, encoding: 'utf8', windowsHide: true, env });
            };
            const configArgs = ['config', 'list', '--all', '--format=json(auth)', '--quiet'];
            checkAuthConfiguration((await invoke(configArgs, baseEnv, 3000)).stdout);
            // Empty SDK environment properties override config files, including a concurrent change.
            const pinnedEnv = { ...baseEnv, CLOUDSDK_CORE_ACCOUNT: account };
            for (const key of Object.keys(pinnedEnv)) {
                if (key.toUpperCase().startsWith('CLOUDSDK_AUTH_')) {
                    delete pinnedEnv[key];
                }
            }
            for (const name of EMPTY_AUTH) {
                pinnedEnv['CLOUDSDK_AUTH_' + name] = '';
            }
            pinnedEnv.CLOUDSDK_AUTH_DISABLE_CREDENTIALS = 'false';
            checkAuthConfiguration((await invoke(configArgs, pinnedEnv, 3000)).stdout);
            const result = await invoke(['auth', 'print-access-token', '--account', account, '--quiet'], pinnedEnv, 6000);
            assert.equal(signal.aborted, false);
            const token = result.stdout.trim();
            assert(token.length > 0 && token.length <= 8192);
            assert(!/\s/u.test(token));
            return token;
        }
        catch {
            throw new Error('OFFICIAL_AUTHENTICATION_FAILED');
        }
    };
}
