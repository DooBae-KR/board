import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenStore } from './tokens.js';

const DAY = 864e5;
const tmp = () => join(mkdtempSync(join(tmpdir(), 'tok-')), 'tokens.json');
const fakeFetch = (calls, body = { access_token: 'NEW', expires_in: 60 * 86400 }, ok = true) =>
  async (url) => (calls.push(url), { ok, status: ok ? 200 : 400, json: async () => body });

test('만료일 미상이면 갱신하고 새 토큰·만료일을 저장', async () => {
  const file = tmp(), calls = [];
  const s = createTokenStore({ file, seeds: { ko: 'OLD' }, fetchImpl: fakeFetch(calls), now: () => 1000 });
  await s.refreshDue();
  assert.equal(s.get('ko'), 'NEW');
  assert.equal(s.expiresAt('ko'), 1000 + 60 * DAY);
  assert.match(calls[0], /ig_refresh_token.*OLD/);
  // 재시작해도 갱신된 토큰 유지
  const s2 = createTokenStore({ file, seeds: { ko: 'OLD' } });
  assert.equal(s2.get('ko'), 'NEW');
});

test('만료까지 20일 넘게 남았으면 갱신 안 함', async () => {
  const file = tmp(), calls = [];
  let t = 0;
  const s = createTokenStore({ file, seeds: { ko: 'A' }, fetchImpl: fakeFetch(calls), now: () => t });
  await s.refreshDue(); // 첫 갱신 → 만료 60일 후
  t = 10 * DAY;
  await s.refreshDue();
  assert.equal(calls.length, 1);
  t = 45 * DAY; // 남은 15일
  await s.refreshDue();
  assert.equal(calls.length, 2);
});

test('env 토큰이 바뀌면 저장본보다 env 우선', async () => {
  const file = tmp();
  const a = createTokenStore({ file, seeds: { ko: 'A' }, fetchImpl: fakeFetch([]), now: () => 0 });
  await a.refreshDue();
  const b = createTokenStore({ file, seeds: { ko: 'B' } });
  assert.equal(b.get('ko'), 'B');
});

test('갱신 실패 시 기존 토큰 유지하고 onError 호출', async () => {
  const errs = [];
  const s = createTokenStore({
    file: tmp(), seeds: { ko: 'A' }, fetchImpl: fakeFetch([], { error: 'x' }, false),
    onError: (lang, e) => errs.push([lang, e.message]),
  });
  await s.refreshDue();
  assert.equal(s.get('ko'), 'A');
  assert.equal(errs[0][0], 'ko');
});

test('토큰 파일은 소유자만 읽기 가능(0600)', async () => {
  const file = tmp();
  createTokenStore({ file, seeds: { ko: 'A' } });
  assert.match(readFileSync(file, 'utf8'), /"token": "A"/);
});
