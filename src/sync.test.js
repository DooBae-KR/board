import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepoSync } from './sync.js';

const good = [{ id: 'a-ko', mediaId: '123', keyword: '링크', name: 'A', url: 'https://github.com/o/a' }];
const resp = (body, { status = 200, etag = '"e1"' } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => (k.toLowerCase() === 'etag' ? etag : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const setup = (responses) => {
  const file = join(mkdtempSync(join(tmpdir(), 'sync-')), 'repos.json');
  writeFileSync(file, '[]');
  const calls = [], errors = [];
  const fetchImpl = async (url, opts) => (calls.push({ url, opts }), responses.shift());
  const sync = createRepoSync({ repo: 'o/r', file, fetchImpl, token: 'TKN', onError: (e) => errors.push(e.message) });
  return { file, sync, calls, errors };
};

test('변경된 파일을 반영하고 백업을 남김', async () => {
  const { file, sync, calls } = setup([resp(good)]);
  await sync.syncOnce();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), good);
  assert.ok(existsSync(`${file}.bak`));
  assert.equal(sync.status().ok, true);
  assert.equal(sync.status().count, 1);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer TKN');
  assert.match(calls[0].url, /repos\/o\/r\/contents\/data\/repos\.json\?ref=main/);
});

test('ETag로 304면 변경 없음 처리', async () => {
  const { sync, calls } = setup([resp(good), resp('', { status: 304 })]);
  await sync.syncOnce();
  await sync.syncOnce();
  assert.equal(calls[1].opts.headers['If-None-Match'], '"e1"');
  assert.equal(sync.status().ok, true);
});

test('검증 실패(잘못된 URL/중복 id/깨진 JSON)면 기존 파일 유지하고 오류 기록', async () => {
  const bad = [
    [{ ...good[0], url: 'https://evil.example/x' }],
    [good[0], good[0]],
    '{ not json',
  ];
  for (const b of bad) {
    const { file, sync, errors } = setup([resp(b)]);
    await sync.syncOnce();
    assert.equal(readFileSync(file, 'utf8'), '[]');
    assert.equal(sync.status().ok, false);
    assert.equal(errors.length, 1);
  }
});

test('HTTP 오류(404/403)도 기존 파일 유지', async () => {
  const { file, sync, errors } = setup([resp('', { status: 404 })]);
  await sync.syncOnce();
  assert.equal(readFileSync(file, 'utf8'), '[]');
  assert.match(errors[0], /404/);
});

test('repo 미설정이면 비활성', () => {
  const s = createRepoSync({ file: '/x' });
  assert.equal(s.status().enabled, false);
});
