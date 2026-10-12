// YouTube Data API v3 도우미: 구독자 조회, 영상 업로드(재개 가능 업로드), 활동지수 계산.
// 키·토큰은 호출하는 쪽이 환경변수에서 넘긴다. 이 파일은 어떤 값도 출력하거나 저장하지 않는다.
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';

export const API = 'https://www.googleapis.com/youtube/v3';
export const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
export const PRIVACY = ['private', 'unlisted', 'public'];
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' };

/** 네트워크가 막혔을 때 원인을 알아보기 쉽게 바꾼다 (요청 주소의 키는 메시지에 넣지 않는다) */
export const safeFetch = (f) => async (url, init) => {
  try { return await f(url, init); } catch (e) { throw new YouTubeError(`구글 서버에 연결하지 못했습니다 (${e.cause?.code || e.code || e.message}). 네트워크·방화벽 설정을 확인하세요`); }
};

export class YouTubeError extends Error { constructor(message, status) { super(message); this.name = 'YouTubeError'; this.status = status; } }

async function json(res, what) {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new YouTubeError(`${what} 실패 (${res.status}): ${j.error?.message || j.error_description || j.error || '응답 없음'}`, res.status);
  return j;
}

/** 리프레시 토큰으로 액세스 토큰을 새로 받는다 (업로드·mine 조회에 필요) */
export async function refreshAccessToken({ clientId, clientSecret, refreshToken }, f = fetch) {
  f = safeFetch(f);
  if (!clientId || !clientSecret || !refreshToken) throw new YouTubeError('YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN이 필요합니다 (node scripts/youtube.js auth)');
  const res = await f(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  return (await json(res, '토큰 갱신')).access_token;
}

/** 동의 화면 주소 (한 번만 쓴다. offline + consent로 리프레시 토큰을 받는다) */
export const consentUrl = ({ clientId, redirectUri, state }) => `${AUTH_URL}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state })}`;
export async function exchangeCode({ clientId, clientSecret, redirectUri, code }, f = fetch) {
  f = safeFetch(f);
  const res = await f(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: 'authorization_code' }) });
  return json(res, '코드 교환');
}

/** 구독자 수 등 채널 통계. 공개 채널은 API 키 + (channelId | handle), 본인 채널은 액세스 토큰 + mine */
export async function channelStats({ apiKey, accessToken, channelId, handle }, f = fetch) {
  f = safeFetch(f);
  const q = new URLSearchParams({ part: 'statistics,contentDetails,snippet' });
  if (channelId) q.set('id', channelId); else if (handle) q.set('forHandle', handle); else if (accessToken) q.set('mine', 'true');
  else throw new YouTubeError('YT_CHANNEL_ID 또는 YT_HANDLE(공개 채널)이 필요합니다. 본인 채널로 조회하려면 OAuth 설정이 필요합니다');
  const headers = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`; else if (apiKey) q.set('key', apiKey); else throw new YouTubeError('YT_API_KEY가 비어 있습니다');
  const j = await json(await f(`${API}/channels?${q}`, { headers }), '채널 조회');
  const c = j.items?.[0];
  if (!c) throw new YouTubeError('채널을 찾지 못했습니다. YT_CHANNEL_ID/YT_HANDLE을 확인하세요');
  const s = c.statistics || {};
  return {
    id: c.id, title: c.snippet?.title ?? '', uploads: c.contentDetails?.relatedPlaylists?.uploads ?? null,
    hidden: !!s.hiddenSubscriberCount, subscribers: s.hiddenSubscriberCount ? null : Number(s.subscriberCount ?? 0),
    views: Number(s.viewCount ?? 0), videos: Number(s.videoCount ?? 0),
  };
}

/** 최근 days일 안에 올린 영상과 조회수 (업로드 재생목록 1회 + 영상 통계 1회, 각 1 할당량) */
export async function recentVideos({ apiKey, accessToken, uploads, days = 28, now = Date.now() }, f = fetch) {
  f = safeFetch(f);
  if (!uploads) return [];
  const auth = (q) => { const h = {}; if (accessToken) h.authorization = `Bearer ${accessToken}`; else q.set('key', apiKey); return h; };
  const q1 = new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: '50' });
  const items = (await json(await f(`${API}/playlistItems?${q1}`, { headers: auth(q1) }), '업로드 목록 조회')).items || [];
  const recent = items.filter((i) => now - Date.parse(i.contentDetails?.videoPublishedAt) <= days * 864e5).map((i) => i.contentDetails.videoId);
  if (!recent.length) return [];
  const q2 = new URLSearchParams({ part: 'statistics', id: recent.join(',') });
  const vs = (await json(await f(`${API}/videos?${q2}`, { headers: auth(q2) }), '영상 통계 조회')).items || [];
  return vs.map((v) => ({ id: v.id, views: Number(v.statistics?.viewCount ?? 0) }));
}

/**
 * 활동지수(0~100, 예시 공식): 최근 28일 업로드 4건이면 50점 + 최근 영상 조회수 합이 구독자 수만큼이면 50점.
 * 구독자가 숨김이면 조회 점수는 0으로 둔다. 기준은 사람이 바꿔도 된다.
 */
export function activityIndex({ videos, subscribers }) {
  const up = Math.min(50, videos.length * 12.5);
  const views = videos.reduce((t, v) => t + v.views, 0);
  const vs = subscribers ? Math.min(50, (views / Math.max(subscribers, 100)) * 50) : 0;
  return Math.round(up + vs);
}

/** 업로드 메타데이터를 검증해 videos.insert 본문으로 만든다. 기본은 비공개(실수로 공개되는 것을 막는다) */
export function buildVideoBody({ title, description = '', tags = [], categoryId = '22', privacy = 'private', madeForKids = false }) {
  const t = String(title ?? '').trim();
  if (!t) throw new YouTubeError('제목이 필요합니다');
  if (t.length > 100 || /[<>]/.test(t)) throw new YouTubeError('제목은 100자 이하이고 < > 를 쓸 수 없습니다');
  if (Buffer.byteLength(description) > 5000) throw new YouTubeError('설명은 5000바이트 이하여야 합니다');
  if (!PRIVACY.includes(privacy)) throw new YouTubeError(`공개 범위는 ${PRIVACY.join(', ')} 중 하나여야 합니다`);
  const tg = (Array.isArray(tags) ? tags : String(tags).split(',')).map((x) => x.trim()).filter(Boolean);
  if (tg.join(',').length > 500) throw new YouTubeError('태그는 합쳐서 500자 이하여야 합니다');
  return { snippet: { title: t, description, tags: tg, categoryId: String(categoryId) }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: !!madeForKids } };
}

/** 재개 가능 업로드: ① 메타데이터로 세션을 열고(Location 받기) ② 파일을 보낸다. 성공하면 { id, url } */
export async function uploadVideo({ accessToken, file, body }, f = fetch) {
  f = safeFetch(f);
  if (!accessToken) throw new YouTubeError('업로드에는 OAuth 액세스 토큰이 필요합니다 (API 키만으로는 올릴 수 없습니다)');
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new YouTubeError(`지원하는 영상 형식: ${Object.keys(MIME).join(', ')}`);
  const size = statSync(file).size;
  if (!size) throw new YouTubeError('빈 파일입니다');
  const start = await f(`${UPLOAD_API}?${new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' })}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': mime },
    body: JSON.stringify(body),
  });
  if (!start.ok) await json(start, '업로드 시작');
  const location = start.headers.get('location');
  if (!location) throw new YouTubeError('업로드 주소(Location)를 받지 못했습니다');
  const put = await f(location, { method: 'PUT', headers: { 'content-type': mime, 'content-length': String(size) }, body: Readable.toWeb(createReadStream(file)), duplex: 'half' });
  const v = await json(put, '영상 전송');
  return { id: v.id, url: `https://youtu.be/${v.id}`, privacy: v.status?.privacyStatus ?? body.status.privacyStatus };
}

/** 대시보드 '유튜브 현황' 위젯(kpi) 항목 */
export const widgetItems = ({ stats, videos, index }) => [
  { label: '구독자', value: stats.hidden ? 0 : stats.subscribers, unit: '명', ...(stats.hidden ? { delta: '구독자 수 숨김' } : {}) },
  { label: '활동지수', value: index, unit: '', note: `최근 28일 업로드 ${videos.length}건 · 조회 ${videos.reduce((t, v) => t + v.views, 0).toLocaleString('ko-KR')}회 기준 (예시 공식)` },
  { label: '총 조회수', value: stats.views, unit: '회' }, { label: '영상', value: stats.videos, unit: '개' },
];
