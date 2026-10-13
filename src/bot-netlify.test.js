import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleWebhook, runMaintenance, runReconcile } from './bot-netlify.js';
import { createDbTokenStore } from './tokens-db.js';
import { SupabaseError } from '../scripts/lib/supabase.js';

// igbot_* 테이블만 흉내 내는 DB
function fakeDb() {
  const t = { igbot_tokens: [], igbot_seen: [], igbot_events: [] };
  const pk = { igbot_tokens: 'lang', igbot_seen: 'key' };
  return {
    t,
    async select(table) { return structuredClone(t[table]); },
    async insert(table, rows) {
      for (const r of rows) if (pk[table] && t[table].some((x) => x[pk[table]] === r[pk[table]])) throw new SupabaseError('duplicate', 409, '23505');
      t[table].push(...structuredClone(rows)); return rows;
    },
    async upsert(table, rows) {
      for (const r of rows) { const i = t[table].findIndex((x) => x[pk[table]] === r[pk[table]]); if (i >= 0) t[table][i] = { ...t[table][i], ...r }; else t[table].push({ ...r }); }
      return rows;
    },
    async remove(table, filter) { const cut = decodeURIComponent(filter.split('lt.')[1]); t[table] = t[table].filter((x) => !(x.created_at < cut)); return []; },
  };
}

const ENV = { APP_SECRET: 's3', VERIFY_TOKEN: 'vt', IG_KO_USER_ID: 'acc', IG_KO_ACCESS_TOKEN: 'TOK' };
const repos = [{ id: 'r1', mediaId: 'm1', keyword: '링크', name: 'Repo', url: 'https://github.com/a/b' }];
const post = (body, secret = 's3') => {
  const raw = JSON.stringify(body);
  return new Request('https://x/webhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
};
const comment = (id) => ({ entry: [{ id: 'acc', changes: [{ field: 'comments', value: { id, text: '링크', from: { id: 'u1' }, media: { id: 'm1' } } }] }] });

let calls, realFetch;
beforeEach(() => {
  calls = []; realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body }); return { ok: true, status: 200, json: async () => ({ is_user_follow_business: true }) }; };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('웹훅 확인(GET): 토큰이 맞을 때만 challenge를 돌려준다', async () => {
  const ok = await handleWebhook(new Request('https://x/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123'), { env: ENV, db: fakeDb(), repos });
  assert.equal(await ok.text(), '123');
  const bad = await handleWebhook(new Request('https://x/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1'), { env: ENV, db: fakeDb(), repos });
  assert.equal(bad.status, 403);
  const noEnv = await handleWebhook(new Request('https://x/webhook?hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1'), { env: {}, db: fakeDb(), repos });
  assert.equal(noEnv.status, 403);
});

test('서명이 틀리면 401, APP_SECRET이 없으면 500(검증 우회 금지)', async () => {
  assert.equal((await handleWebhook(post(comment('c1'), 'wrong'), { env: ENV, db: fakeDb(), repos })).status, 401);
  assert.equal((await handleWebhook(post(comment('c1')), { env: { ...ENV, APP_SECRET: '' }, db: fakeDb(), repos })).status, 500);
});

test('서명이 틀린 요청은 오류를 1시간에 한 번만 기록하고, 서명 헤더가 없으면 기록하지 않는다', async () => {
  const db = fakeDb();
  for (let i = 0; i < 3; i++) assert.equal((await handleWebhook(post(comment('c' + i), 'wrong'), { env: ENV, db, repos })).status, 401);
  assert.equal(db.t.igbot_events.filter((e) => e.event === 'error').length, 1);
  assert.match(db.t.igbot_events[0].detail, /APP_SECRET/);
  assert.equal(JSON.stringify(db.t.igbot_events).includes('wrong'), false);
  const db2 = fakeDb();
  const noSig = new Request('https://x/webhook', { method: 'POST', body: '{}' });
  assert.equal((await handleWebhook(noSig, { env: ENV, db: db2, repos })).status, 401);
  assert.equal(db2.t.igbot_events.length, 0);
});

test('팔로워 댓글 → DM 전송, 같은 댓글이 다시 와도(다른 인스턴스) 한 번만 처리', async () => {
  const db = fakeDb();
  assert.equal((await handleWebhook(post(comment('c1')), { env: ENV, db, repos })).status, 200);
  const sends = () => calls.filter((c) => c.url.endsWith('/acc/messages'));
  assert.equal(sends().length, 1);
  assert.match(sends()[0].body, /github\.com\/a\/b/);
  await handleWebhook(post(comment('c1')), { env: ENV, db, repos });
  assert.equal(sends().length, 1);
  assert.deepEqual(db.t.igbot_events.map((e) => e.event), ['matched', 'link_direct']); // 집계가 DB에 남는다
  assert.equal(db.t.igbot_tokens[0].token, 'TOK');
});

test('처리 중 Graph API 오류가 나도 200이고 오류가 기록된다', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'x' }) });
  const db = fakeDb();
  // isFollowing 실패는 버튼 방식으로 이어지고, sendMessage 실패가 오류로 남는다
  const res = await handleWebhook(post(comment('c9')), { env: ENV, db, repos });
  assert.equal(res.status, 200);
  assert.ok(db.t.igbot_events.some((e) => e.event === 'error'));
});

test('토큰 저장소를 못 읽으면 500(Meta가 재전송)', async () => {
  const db = fakeDb(); db.select = async () => { throw new SupabaseError('down', 500); };
  assert.equal((await handleWebhook(post(comment('c2')), { env: ENV, db, repos })).status, 500);
});

test('토큰 보관소: 환경변수가 바뀌면 환경변수 우선, 같으면 저장본(갱신본) 유지', async () => {
  const db = fakeDb();
  const mk = (seed, extra = {}) => createDbTokenStore({ db, seeds: { ko: seed }, now: () => 1000, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'NEW', expires_in: 60 * 86400 }) }), ...extra });
  const a = mk('A'); await a.load(); await a.refreshDue();
  assert.equal(a.get('ko'), 'NEW');
  const same = mk('A'); await same.load();
  assert.equal(same.get('ko'), 'NEW');
  assert.equal(same.expiresAt('ko'), 1000 + 60 * 86400_000);
  const changed = mk('B'); await changed.load();
  assert.equal(changed.get('ko'), 'B');
  assert.equal(changed.expiresAt('ko'), null);
});

test('예약 함수: 만료 20일 넘게 남으면 갱신하지 않고, 3일 지난 중복 키만 지운다', async () => {
  const db = fakeDb();
  const now = Date.parse('2026-10-08T00:00:00Z');
  db.t.igbot_seen.push({ key: 'old', created_at: '2026-10-01T00:00:00Z' }, { key: 'new', created_at: '2026-10-07T12:00:00Z' });
  let refreshes = 0;
  globalThis.fetch = async (url) => { if (String(url).includes('refresh_access_token')) refreshes++; return { ok: true, status: 200, json: async () => ({ access_token: 'N2', expires_in: 60 * 86400 }) }; };
  await runMaintenance({ env: ENV, db, now: () => now });      // 만료일 미상 → 갱신
  await runMaintenance({ env: ENV, db, now: () => now + 1000 }); // 60일 남음 → 건너뜀
  assert.equal(refreshes, 1);
  assert.deepEqual(db.t.igbot_seen.map((r) => r.key), ['new']);
});

test('재조회: 웹훅이 놓친 댓글에만 DM, 이미 처리한 댓글은 건너뜀, 등록 안 된 게시물은 미디어 ID만 기록', async () => {
  const db = fakeDb();
  const now = Date.parse('2026-10-13T12:00:00Z');
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/media?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1', permalink: 'https://www.instagram.com/p/AAA/' }, { id: 'm9', permalink: 'https://www.instagram.com/p/BBB/' }] }) };
    if (u.includes('m1/comments')) return { ok: true, status: 200, json: async () => ({ data: [
      { id: 'c-new', text: '링크 주세요', timestamp: '2026-10-13T11:00:00Z', from: { id: 'u1' } },
      { id: 'c-done', text: '링크', timestamp: '2026-10-13T10:00:00Z', from: { id: 'u2' } },
      { id: 'c-old', text: '링크', timestamp: '2026-10-01T10:00:00Z', from: { id: 'u3' } },
      { id: 'c-own', text: '링크', timestamp: '2026-10-13T09:00:00Z', from: { id: 'acc' } },
      { id: 'c-other', text: '안녕', timestamp: '2026-10-13T09:30:00Z', from: { id: 'u4' } },
    ] }) };
    if (u.includes('is_user_follow_business')) return { ok: true, status: 200, json: async () => ({ is_user_follow_business: true }) };
    if (u.endsWith('/messages')) { sent.push(JSON.parse(init.body).recipient); return { ok: true, status: 200, json: async () => ({}) }; }
    throw new Error('unexpected ' + u);
  };
  db.t.igbot_seen.push({ key: 'c:c-done' }); // 웹훅이 이미 처리함
  const r = await runReconcile({ env: ENV, db, repos, now: () => now });
  assert.deepEqual(sent, [{ comment_id: 'c-new' }]);
  assert.equal(r.ko.errors, 0);
  const media = db.t.igbot_events.filter((e) => e.event === 'media');
  assert.equal(media.length, 1);
  assert.match(media[0].detail, /media:m9 https:\/\/www\.instagram\.com\/p\/BBB/);
  // 두 번째 실행: 같은 댓글·게시물은 다시 처리·기록하지 않는다
  await runReconcile({ env: ENV, db, repos, now: () => now });
  assert.equal(sent.length, 1);
  assert.equal(db.t.igbot_events.filter((e) => e.event === 'media').length, 1);
});

test('재조회: 게시물 목록 조회가 실패하면 오류를 기록하고 멈추지 않는다', async () => {
  const db = fakeDb();
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'x' }) });
  const r = await runReconcile({ env: ENV, db, repos });
  assert.equal(r.ko.errors, 1);
  assert.match(db.t.igbot_events[0].detail, /재조회/);
});
