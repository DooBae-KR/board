// 인스타 DM 봇의 서버리스 버전: 웹훅 처리와 토큰 갱신 (Netlify Functions용).
// 상시 서버(src/server.js)가 디스크·메모리로 하던 일을 Supabase(igbot_* 테이블)로 옮겼다.
import { createHandlers } from './handlers.js';
import { createApi, verifySignature } from './instagram.js';
import { createDbTokenStore } from './tokens-db.js';
import { record, setSink, flushSink } from './stats.js';
import { SupabaseError } from '../scripts/lib/supabase.js';

/** 환경변수에서 활성 계정의 { ko: {userId, token}, en: ... } 를 뽑는다 */
export function accountsFromEnv(env) {
  const out = {};
  for (const [lang, key] of [['ko', 'KO'], ['en', 'EN']]) {
    const userId = env[`IG_${key}_USER_ID`], token = env[`IG_${key}_ACCESS_TOKEN`];
    if (userId && token) out[lang] = { userId, token };
  }
  return out;
}

/** 처음 보는 이벤트 키면 true. DB의 기본키 충돌(409)을 "이미 처리함"으로 본다 */
export const dbOnce = (db) => async (key) => {
  try {
    await db.insert('igbot_seen', [{ key }]);
    return true;
  } catch (e) {
    if (e instanceof SupabaseError && e.status === 409) return false;
    console.error('중복 확인 실패, 처리를 계속합니다:', e.message);
    return true;
  }
};

const text = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function withEventSink(db, fn) {
  setSink(async (rows) => { try { await db.insert('igbot_events', rows); } catch (e) { console.error('집계 기록 실패:', e.message); } });
  try { return await fn(); } finally { await flushSink(); }
}

/**
 * @param {Request} request
 * @param {{ env: object, db: object, repos: object[] }} deps
 */
export async function handleWebhook(request, { env, db, repos }) {
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    const ok = !!env.VERIFY_TOKEN && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === env.VERIFY_TOKEN;
    return ok ? text(q.get('hub.challenge') ?? '') : text('forbidden', 403);
  }
  if (request.method !== 'POST') return text('method not allowed', 405);
  // 서명 검증을 끌 수 있는 로컬 편의(APP_SECRET 없음)가 공개 배포에서 열려 있지 않게 막는다
  if (!env.APP_SECRET) return text('APP_SECRET is not configured', 500);

  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), env.APP_SECRET)) return text('unauthorized', 401);

  const igs = accountsFromEnv(env);
  const seeds = Object.fromEntries(Object.entries(igs).map(([lang, a]) => [lang, a.token]));
  const tokens = createDbTokenStore({ db, seeds });
  try {
    await tokens.load(); // 저장소를 못 읽으면 500으로 돌려 Meta가 다시 보내게 한다
  } catch (e) {
    console.error('토큰 불러오기 실패:', e.message);
    return text('token store unavailable', 500);
  }
  const accounts = {};
  for (const [lang, a] of Object.entries(igs)) accounts[a.userId] = { lang, api: createApi({ igUserId: a.userId, token: () => tokens.get(lang) }) };

  return withEventSink(db, async () => {
    try {
      await createHandlers({ accounts, loadRepos: () => repos, once: dbOnce(db) })(JSON.parse(raw));
    } catch (e) {
      record('-', 'error', { detail: String(e.message).slice(0, 200) });
      console.error(e);
    }
    return text('ok'); // 처리 도중 오류가 나도 200: 같은 이벤트가 계속 재전송되지 않게 한다 (기존 동작과 같음)
  });
}

/** 예약 함수: 만료가 가까운 토큰 갱신 + 오래된 중복 방지 키 정리 */
export async function runMaintenance({ env, db, now = Date.now }) {
  const igs = accountsFromEnv(env);
  const tokens = createDbTokenStore({
    db, seeds: Object.fromEntries(Object.entries(igs).map(([lang, a]) => [lang, a.token])),
    onError: (lang, e) => { record(lang, 'error', { detail: e.message }); console.error(e.message); },
  });
  return withEventSink(db, async () => {
    await tokens.load();
    await tokens.refreshDue();
    await db.remove('igbot_seen', `created_at=lt.${encodeURIComponent(new Date(now() - 3 * 86400_000).toISOString())}`);
    return Object.fromEntries(Object.keys(igs).map((lang) => [lang, tokens.expiresAt(lang) ? new Date(tokens.expiresAt(lang)).toISOString() : null]));
  });
}
