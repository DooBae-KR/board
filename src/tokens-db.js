import { createHash } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// tokens.js(파일)와 같은 규칙의 토큰 보관소를 DB(igbot_tokens)에 둔다. 서버리스용.
// - 호출마다 load()로 읽고, 갱신은 예약 함수(refreshDue)만 한다
// - 환경변수 토큰이 바뀌면(해시가 다르면) 저장본보다 환경변수 우선
export function createDbTokenStore({ db, seeds, fetchImpl = fetch, now = Date.now, onError = () => {} }) {
  const state = {}; // { [lang]: { token, expiresAt, seedHash } }
  const langs = Object.keys(seeds);

  async function load() {
    const rows = await db.select('igbot_tokens', 'select=lang,token,seed_sha256,expires_at');
    for (const lang of langs) {
      const row = rows.find((r) => r.lang === lang);
      const seedHash = sha(seeds[lang]);
      if (row && row.seed_sha256 === seedHash) {
        state[lang] = { token: row.token, expiresAt: row.expires_at ? Date.parse(row.expires_at) : null, seedHash };
      } else {
        state[lang] = { token: seeds[lang], expiresAt: null, seedHash };
        await db.upsert('igbot_tokens', [{ lang, token: seeds[lang], seed_sha256: seedHash, expires_at: null, updated_at: new Date(now()).toISOString() }], 'lang');
      }
    }
  }

  async function refresh(lang) {
    const res = await fetchImpl(`${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(state[lang].token)}`);
    const json = await res.json();
    if (!res.ok || !json.access_token) throw new Error(`token refresh failed (${lang}): ${res.status}`);
    const expiresAt = now() + json.expires_in * 1000;
    await db.upsert('igbot_tokens', [{ lang, token: json.access_token, seed_sha256: state[lang].seedHash, expires_at: new Date(expiresAt).toISOString(), updated_at: new Date(now()).toISOString() }], 'lang');
    state[lang] = { ...state[lang], token: json.access_token, expiresAt };
  }

  async function refreshDue(thresholdDays = 20) {
    for (const lang of langs) {
      const { expiresAt } = state[lang];
      if (expiresAt !== null && expiresAt - now() > thresholdDays * DAY) continue;
      try { await refresh(lang); } catch (e) { onError(lang, e); }
    }
  }

  return { load, get: (lang) => state[lang].token, expiresAt: (lang) => state[lang]?.expiresAt ?? null, refreshDue };
}
