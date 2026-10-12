#!/usr/bin/env node
// 유튜브 구독자 조회·영상 업로드·대시보드 보고
//   node --env-file=.env scripts/youtube.js stats                      구독자·조회수·영상 수와 활동지수 출력
//   node --env-file=.env scripts/youtube.js report                     같은 값을 대시보드 '유튜브 현황' 위젯으로 보고
//   node --env-file=.env scripts/youtube.js upload <영상파일> --title "제목" [--desc "설명"] [--tags a,b] [--privacy private|unlisted|public] [--category 22] [--kids]
//   node --env-file=.env scripts/youtube.js auth                       (처음 한 번) 브라우저 동의 → 리프레시 토큰 출력
// 환경변수(모두 비워 둔 채로 두면 해당 명령이 무엇이 필요한지 알려 주고 멈춘다):
//   YT_API_KEY            공개 채널 구독자 조회용 API 키
//   YT_CHANNEL_ID|YT_HANDLE   조회할 채널 (예: UC..., @handle)
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN   업로드·본인 채널 조회용 OAuth (업로드는 API 키만으로 안 된다)
//   report에는 HARNESS_API_URL, HARNESS_API_TOKEN. 키·토큰은 출력하지 않는다.
// 업로드는 기본 비공개다. 공개하려면 --privacy public을 직접 적는다. 업로드 1건은 할당량 약 1600단위(기본 하루 10000).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { activityIndex, buildVideoBody, channelStats, consentUrl, exchangeCode, recentVideos, refreshAccessToken, uploadVideo, widgetItems } from './lib/youtube.js';

const env = process.env, argv = process.argv.slice(3);
const fail = (m) => { console.error(m); process.exit(1); };
const arg = (k, d) => { const i = argv.indexOf('--' + k); if (i < 0) return d; const n = argv[i + 1]; return !n || n.startsWith('--') ? true : n; };
const oauth = { clientId: env.YT_CLIENT_ID, clientSecret: env.YT_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN };
const hasOauth = () => !!(oauth.clientId && oauth.clientSecret && oauth.refreshToken);
const guard = async (fn) => { try { return await fn(); } catch (e) { if (e.name === 'YouTubeError') fail(e.message); throw e; } };

async function collect() {
  const accessToken = hasOauth() ? await refreshAccessToken(oauth) : undefined;
  const who = { apiKey: env.YT_API_KEY, accessToken, channelId: env.YT_CHANNEL_ID, handle: env.YT_HANDLE };
  const stats = await channelStats(who);
  const videos = await recentVideos({ ...who, uploads: stats.uploads });
  return { stats, videos, index: activityIndex({ videos, subscribers: stats.subscribers }) };
}

async function stats() {
  const { stats: s, videos, index } = await collect();
  console.log(`${s.title} (${s.id})\n구독자 ${s.hidden ? '숨김' : s.subscribers.toLocaleString('ko-KR')}명 · 총 조회수 ${s.views.toLocaleString('ko-KR')}회 · 영상 ${s.videos}개\n최근 28일 업로드 ${videos.length}건 · 활동지수 ${index}/100 (예시 공식)`);
  return { stats: s, videos, index };
}

async function report() {
  if (!env.HARNESS_API_URL || !env.HARNESS_API_TOKEN) fail('report에는 HARNESS_API_URL, HARNESS_API_TOKEN이 필요합니다.');
  const r = await stats();
  const res = await fetch(`${env.HARNESS_API_URL.replace(/\/$/, '')}/api/harness/widgets`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.HARNESS_API_TOKEN}` }, body: JSON.stringify({ section: '우리 허브', type: 'kpi', title: '유튜브 현황', data: { items: widgetItems(r) } }) });
  console.log(res.ok ? '대시보드(유튜브 현황)에 반영했어요.' : `대시보드 반영 실패 (${res.status})`);
}

async function upload() {
  const file = argv[0];
  if (!file || file.startsWith('--')) fail('사용법: youtube.js upload <영상파일> --title "제목" [--desc 설명] [--tags a,b] [--privacy private|unlisted|public]');
  if (!existsSync(file)) fail(`파일이 없습니다: ${file}`);
  const body = buildVideoBody({ title: arg('title', ''), description: arg('desc', ''), tags: arg('tags', ''), categoryId: arg('category', '22'), privacy: arg('privacy', 'private'), madeForKids: arg('kids', false) === true });
  const accessToken = await refreshAccessToken(oauth);
  const r = await uploadVideo({ accessToken, file, body });
  console.log(`업로드 완료: ${r.url} (공개 범위: ${r.privacy})`);
  if (r.privacy === 'private' && body.status.privacyStatus !== 'private') console.log('요청은 공개였지만 비공개로 올라갔어요. 심사를 받지 않은 API 프로젝트는 업로드가 비공개로 잠길 수 있어요(YouTube API 서비스 약관 확인).');
}

/** 처음 한 번만: 127.0.0.1에서 동의 결과를 받아 리프레시 토큰을 화면에 보여 준다 (파일에 저장하지 않는다) */
async function auth() {
  if (!oauth.clientId || !oauth.clientSecret) fail('YT_CLIENT_ID, YT_CLIENT_SECRET이 필요합니다 (Google Cloud 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID, 유형: 데스크톱 앱).');
  const state = randomBytes(12).toString('hex'), port = 8976, redirectUri = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const srv = createServer(async (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.writeHead(400).end('잘못된 요청'); return; }
      try {
        const t = await exchangeCode({ clientId: oauth.clientId, clientSecret: oauth.clientSecret, redirectUri, code: u.searchParams.get('code') });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('완료했어요. 터미널로 돌아가세요.');
        console.log(t.refresh_token ? `\nYT_REFRESH_TOKEN=${t.refresh_token}\n(.env나 GitHub Secrets에만 넣고, 채팅·커밋·로그에 붙이지 마세요.)` : '\n리프레시 토큰이 오지 않았어요. 계정 설정에서 앱 접근을 지우고 다시 시도하세요.');
        srv.close(); resolve();
      } catch (e) { res.writeHead(500).end('실패'); srv.close(); reject(e); }
    }).listen(port, '127.0.0.1', () => console.log(`브라우저에서 아래 주소를 열어 동의해 주세요:\n${consentUrl({ clientId: oauth.clientId, redirectUri, state })}`));
  });
}

const cmd = process.argv[2];
await guard(async () => {
  if (cmd === 'stats') await stats(); else if (cmd === 'report') await report(); else if (cmd === 'upload') await upload(); else if (cmd === 'auth') await auth();
  else fail('사용법: node --env-file=.env scripts/youtube.js stats|report|upload <파일> --title "제목"|auth');
});
