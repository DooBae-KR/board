import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessApi } from './harness-api.js';
import { handleRequest } from './netlify-adapter.js';
import { createMemoryStore } from '../scripts/lib/memory-store.js';

const api = () => createHarnessApi({
  store: createMemoryStore({ sections: [{ name: '인사팀' }], agents: [{ id: 'lumi', name: '루미', role: 'r', pose: 'idle' }], motions: [{ agent_id: 'lumi', state: 'working', storage_path: 'agent-motions/lumi/working.mp4' }] }),
  dashboardToken: 'd', agentToken: 'a', sprites: ['idle'], pageHtml: '<script nonce="__NONCE__"></script>', supabaseUrl: 'https://p.supabase.co', onError: () => {},
});
const req = (path, init = {}) => new Request('https://samgukji.netlify.app' + path, init);

test('로그인(POST)으로 받은 쿠키로 pageHtml에 nonce를 넣어 돌려준다', async () => {
  const a = api();
  const login = await handleRequest(a, req('/harness/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin' }, body: 'token=d' }));
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /Secure/); // https 주소이므로
  const res = await handleRequest(a, req('/harness', { headers: { Cookie: cookie } }));
  assert.equal(res.status, 200);
  const nonce = /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy'))[1];
  assert.equal(await res.text(), `<script nonce="${nonce}"></script>`);
});

test('POST 본문을 읽고, 에이전트 토큰으로 보고된다', async () => {
  const res = await handleRequest(api(), req('/api/harness/report', { method: 'POST', headers: { Authorization: 'Bearer a', 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'lumi', kind: 'start', message: '일', steps: ['a', 'b'] }) }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'working');
});

test('304와 302는 본문 없이, 403은 JSON으로', async () => {
  const a = api();
  const first = await handleRequest(a, req('/api/harness', { headers: { Authorization: 'Bearer d' } }));
  const etag = first.headers.get('etag');
  assert.equal((await handleRequest(a, req('/api/harness', { headers: { Authorization: 'Bearer d', 'If-None-Match': etag } }))).status, 304);
  const red = await handleRequest(a, req('/api/harness/motion/lumi/working', { headers: { Authorization: 'Bearer d' } }));
  assert.equal(red.status, 302);
  assert.match(red.headers.get('location'), /^https:\/\//);
  const no = await handleRequest(a, req('/api/harness'));
  assert.equal(no.status, 403);
  assert.deepEqual(await no.json(), { error: 'forbidden' });
});

test('처리하지 않는 경로는 404', async () => {
  assert.equal((await handleRequest(api(), req('/other'))).status, 404);
});
