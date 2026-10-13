import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { summarizeIgbot } from './igbot-summary.js';
import { createHarnessApi } from './harness-api.js';
import { createMemoryStore } from '../scripts/lib/memory-store.js';
import { createStore } from '../scripts/lib/store.js';

const NOW = Date.parse('2026-10-13T00:00:00Z');
const DAY = 86_400_000;
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600_000).toISOString();
const ev = (lang, event, hoursAgo, detail = null) => ({ at: at(hoursAgo), lang, event, detail });
const tok = (lang, daysLeft, updatedHoursAgo = 100) => ({ lang, expires_at: new Date(NOW + daysLeft * DAY).toISOString(), updated_at: at(updatedHoursAgo) });

test('집계: 계정(ko/en)별로 이벤트를 세고 합계를 낸다', () => {
  const s = summarizeIgbot({
    events: [ev('ko', 'matched', 1), ev('ko', 'matched', 2), ev('ko', 'link_direct', 2), ev('ko', 'asked', 3), ev('ko', 'click_ok', 4), ev('en', 'matched', 5), ev('en', 'click_retry', 6)],
    tokens: [tok('ko', 30), tok('en', 30)],
  }, { now: NOW });
  assert.deepEqual(s.accounts.ko, { matched: 2, link_direct: 1, asked: 1, click_ok: 1, click_retry: 0, error: 0 });
  assert.equal(s.accounts.en.click_retry, 1);
  assert.equal(s.total.matched, 3);
  assert.deepEqual(s.alerts, []);
});

test('기간 밖 이벤트는 세지 않고, 알 수 없는 계정·이벤트는 무시한다', () => {
  const s = summarizeIgbot({ events: [ev('ko', 'matched', 24 * 8), ev('ko', 'matched', 24 * 6), ev('xx', 'matched', 1), ev('ko', 'bogus', 1)], tokens: [] }, { now: NOW, days: 7 });
  assert.equal(s.accounts.ko.matched, 1);
  assert.equal(s.accounts.xx, undefined);
  assert.deepEqual(Object.keys(s.accounts), ['ko']);
});

test('이벤트도 토큰도 없으면 빈 결과(계정 없음, 경고 없음)', () => {
  const s = summarizeIgbot({}, { now: NOW });
  assert.deepEqual(s.accounts, {});
  assert.deepEqual(s.alerts, []);
  assert.equal(s.errorCount, 0);
  assert.equal(s.total.matched, 0);
});

test('오류만 있어도 계산된다: 웹훅 오류 경고와 오류 개수', () => {
  const s = summarizeIgbot({ events: [ev('-', 'error', 1, 'boom'), ev('-', 'error', 30, 'old')] }, { now: NOW });
  assert.deepEqual(s.accounts, {}); // '-' 는 계정이 아니다
  assert.equal(s.errorCount, 2);
  const a = s.alerts.find((x) => x.code === 'webhook_error');
  assert.equal(a.count, 1); // 24시간 안의 것만
  assert.equal(a.level, 'warn');
  assert.equal(s.errors[0].detail, 'boom');
});

test('토큰 만료: 경계값 7일(경고) / 3일(위험) / 8일(없음) / 이미 만료', () => {
  const lv = (days) => summarizeIgbot({ tokens: [tok('ko', days)] }, { now: NOW }).alerts.find((a) => a.code === 'token_expiry');
  assert.equal(lv(8), undefined);
  assert.equal(lv(7).level, 'warn');
  assert.equal(lv(4).level, 'warn');
  assert.equal(lv(3).level, 'bad');
  assert.equal(lv(-1).message, '토큰이 만료됐어요');
  assert.equal(summarizeIgbot({ tokens: [{ lang: 'ko', expires_at: null, updated_at: null }] }, { now: NOW }).alerts.length, 0); // 만료일을 모르면 경고하지 않는다
});

test('갱신 실패 경고: 이후 토큰이 새로 저장되면 해결로 본다', () => {
  const fail = ev('ko', 'error', 10, 'token refresh failed (ko): 400');
  const open = summarizeIgbot({ events: [fail], tokens: [tok('ko', 30, 20)] }, { now: NOW });
  assert.equal(open.alerts[0].code, 'refresh_failed');
  assert.equal(open.alerts[0].level, 'bad');
  assert.equal(open.alerts[0].lang, 'ko');
  const fixed = summarizeIgbot({ events: [fail], tokens: [tok('ko', 30, 2)] }, { now: NOW });
  assert.equal(fixed.alerts.length, 0);
  const old = summarizeIgbot({ events: [ev('ko', 'error', 24 * 3, 'token refresh failed (ko): 400')], tokens: [tok('ko', 30, 24 * 10)] }, { now: NOW });
  assert.equal(old.alerts.length, 0); // 이틀 넘은 실패는 경고하지 않음
});

test('경고는 위험이 먼저 온다', () => {
  const s = summarizeIgbot({ events: [ev('-', 'error', 1, 'x')], tokens: [tok('ko', 1)] }, { now: NOW });
  assert.deepEqual(s.alerts.map((a) => a.level), ['bad', 'warn']);
});

// --- API ---
async function boot(igbot) {
  const store = createMemoryStore({ igbot });
  const api = createHarnessApi({ store, dashboardToken: 'dash', agentToken: 'agent', sprites: ['idle'], pageUrl: new URL('./harness.html', import.meta.url), onError: () => {} });
  const server = createServer(async (req, res) => { if (!(await api.handle(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, r));
  const call = (path, token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { call, close: () => { server.closeAllConnections(); server.close(); } };
}

test('API: 대시보드만 읽고, 에이전트·무토큰은 403', async () => {
  const t = await boot({ events: [], tokens: [] });
  assert.equal((await t.call('/api/harness/igbot')).status, 403);
  assert.equal((await t.call('/api/harness/igbot', 'agent')).status, 403);
  assert.equal((await t.call('/api/harness/igbot', 'dash')).status, 200);
  t.close();
});

test('API: 집계 응답, 토큰 값은 담기지 않는다', async () => {
  const now = Date.now();
  const t = await boot({
    events: [{ at: new Date(now - 3600_000).toISOString(), lang: 'ko', event: 'matched', detail: null }],
    tokens: [{ lang: 'ko', token: 'SECRET-TOKEN', expires_at: new Date(now + 2 * DAY).toISOString(), updated_at: new Date(now).toISOString() }],
  });
  const res = await t.call('/api/harness/igbot?days=3', 'dash');
  const text = await res.text();
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(text.includes('SECRET-TOKEN'), false);
  const body = JSON.parse(text);
  assert.equal(body.configured, true);
  assert.equal(body.days, 3);
  assert.equal(body.accounts.ko.matched, 1);
  assert.equal(body.alerts[0].code, 'token_expiry');
  t.close();
});

test('API: 데이터 원본이 없으면 configured:false, 잘못된 days는 7로', async () => {
  const none = await boot(null);
  assert.deepEqual(await (await none.call('/api/harness/igbot', 'dash')).json(), { configured: false });
  none.close();
  const t = await boot({ events: [], tokens: [] });
  assert.equal((await (await t.call('/api/harness/igbot?days=999', 'dash')).json()).days, 7);
  assert.equal((await (await t.call('/api/harness/igbot?days=abc', 'dash')).json()).days, 7);
  t.close();
});

test('store.igbotRaw: 토큰 값(token)은 조회하지 않고, 실패하면 null', async () => {
  const calls = [];
  const db = { select: async (table, q) => { calls.push([table, q]); return []; } };
  const raw = await createStore(db).igbotRaw(7);
  assert.deepEqual(raw, { events: [], tokens: [] });
  const tokenQuery = calls.find(([t]) => t === 'igbot_tokens')[1];
  assert.equal(/\btoken\b/.test(tokenQuery.replace('seed_sha256', '')), false);
  assert.match(calls.find(([t]) => t === 'igbot_events')[1], /at=gte\./);
  assert.equal(await createStore({ select: async () => { throw new Error('no table'); } }).igbotRaw(), null);
});
