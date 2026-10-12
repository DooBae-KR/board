import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityIndex, buildVideoBody, channelStats, consentUrl, recentVideos, refreshAccessToken, uploadVideo, widgetItems, YouTubeError } from './youtube.js';

const ok = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });
const KEY = 'TESTKEY123';

test('구독자 조회: API 키 + 핸들, 숨김 처리, 키 없음/채널 없음 오류', async () => {
  let url;
  const f = async (u) => { url = u; return ok({ items: [{ id: 'UC1', snippet: { title: '내 채널' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '1234', viewCount: '99', videoCount: '7' } }] }); };
  const s = await channelStats({ apiKey: KEY, handle: '@me' }, f);
  assert.equal(s.subscribers, 1234); assert.equal(s.uploads, 'UU1');
  assert.match(url, /forHandle=%40me/); assert.match(url, /part=statistics/);
  const hidden = await channelStats({ apiKey: KEY, channelId: 'UC1' }, async () => ok({ items: [{ id: 'UC1', statistics: { hiddenSubscriberCount: true, viewCount: '1', videoCount: '1' } }] }));
  assert.equal(hidden.subscribers, null); assert.equal(hidden.hidden, true);
  await assert.rejects(channelStats({ handle: 'x' }, f), /YT_API_KEY/);
  await assert.rejects(channelStats({ apiKey: KEY }, f), /YT_CHANNEL_ID/);
  await assert.rejects(channelStats({ apiKey: KEY, handle: 'x' }, async () => ok({ items: [] })), /채널을 찾지 못/);
});

test('API 오류와 네트워크 오류는 키 없이 읽기 쉬운 메시지로 나온다', async () => {
  await assert.rejects(channelStats({ apiKey: KEY, handle: 'x' }, async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })), (e) => e instanceof YouTubeError && /400/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(channelStats({ apiKey: KEY, handle: 'x' }, async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }), (e) => /연결하지 못/.test(e.message) && /ENOTFOUND/.test(e.message) && !e.message.includes(KEY));
});

test('최근 28일 영상만 세고 활동지수를 계산한다', async () => {
  const now = Date.parse('2026-10-12T00:00:00Z'), d = (n) => new Date(now - n * 864e5).toISOString();
  const f = async (u) => (String(u).includes('/playlistItems') ? ok({ items: [{ contentDetails: { videoId: 'a', videoPublishedAt: d(3) } }, { contentDetails: { videoId: 'b', videoPublishedAt: d(20) } }, { contentDetails: { videoId: 'c', videoPublishedAt: d(60) } }] }) : ok({ items: [{ id: 'a', statistics: { viewCount: '500' } }, { id: 'b', statistics: { viewCount: '300' } }] }));
  const v = await recentVideos({ apiKey: KEY, uploads: 'UU1', now }, f);
  assert.deepEqual(v.map((x) => x.id), ['a', 'b']);
  assert.equal(activityIndex({ videos: v, subscribers: 1000 }), 25 + 40);
  assert.equal(activityIndex({ videos: [], subscribers: 0 }), 0);
  assert.equal(activityIndex({ videos: Array(10).fill({ views: 1e9 }), subscribers: 100 }), 100);
  const items = widgetItems({ stats: { subscribers: 1234, hidden: false, views: 99, videos: 7 }, videos: v, index: 65 });
  assert.equal(items[0].label, '구독자'); assert.equal(items[1].value, 65);
});

test('업로드 본문: 기본 비공개, 입력 검증', () => {
  const b = buildVideoBody({ title: ' 안녕 ', tags: 'a, b,,c' });
  assert.equal(b.status.privacyStatus, 'private'); assert.deepEqual(b.snippet.tags, ['a', 'b', 'c']); assert.equal(b.snippet.title, '안녕'); assert.equal(b.snippet.categoryId, '22');
  assert.throws(() => buildVideoBody({ title: '' }), /제목/); assert.throws(() => buildVideoBody({ title: 'x'.repeat(101) }), /100자/);
  assert.throws(() => buildVideoBody({ title: 'a<b' }), /< >/); assert.throws(() => buildVideoBody({ title: 'a', privacy: 'secret' }), /공개 범위/);
});

test('업로드: 세션 열기 → Location으로 파일 전송, 토큰·형식 검증', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yt-')), file = join(dir, 'v.mp4'); writeFileSync(file, 'x'.repeat(2048));
  const calls = [];
  const f = async (u, init) => {
    calls.push({ u: String(u), init });
    if (String(u).includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { location: 'https://upload.example/session1' } });
    await new Response(init.body).arrayBuffer().catch(() => {}); // 본문 소비
    return ok({ id: 'VID1', status: { privacyStatus: 'private' } });
  };
  const body = buildVideoBody({ title: '테스트' });
  const r = await uploadVideo({ accessToken: 'AT', file, body }, f);
  assert.equal(r.url, 'https://youtu.be/VID1');
  assert.equal(calls[0].init.headers['x-upload-content-length'], '2048'); assert.equal(calls[0].init.headers.authorization, 'Bearer AT');
  assert.equal(JSON.parse(calls[0].init.body).status.privacyStatus, 'private'); assert.equal(calls[1].u, 'https://upload.example/session1');
  await assert.rejects(uploadVideo({ file, body }, f), /OAuth/);
  const txt = join(dir, 'a.txt'); writeFileSync(txt, 'x');
  await assert.rejects(uploadVideo({ accessToken: 'AT', file: txt, body }, f), /지원하는 영상 형식/);
});

test('토큰 갱신과 동의 주소', async () => {
  let sent;
  const t = await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, async (u, init) => { sent = String(init.body); return ok({ access_token: 'AT' }); });
  assert.equal(t, 'AT'); assert.match(sent, /grant_type=refresh_token/);
  await assert.rejects(refreshAccessToken({}), /YT_CLIENT_ID/);
  const u = new URL(consentUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:8976', state: 'z' }));
  assert.equal(u.searchParams.get('access_type'), 'offline'); assert.match(u.searchParams.get('scope'), /youtube\.upload/);
});
