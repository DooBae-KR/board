import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

// 계정별 장기 토큰(60일)을 파일에 보관하고 만료 전에 자동 갱신한다.
// - seeds: { ko: <env 토큰>, en: <env 토큰> } — env 값이 바뀌면(수동 재발급) 저장본보다 우선
// - 갱신 조건: 만료 20일 이내이거나 만료일을 아직 모를 때 (토큰 발급 후 24시간이 지나야 갱신 가능)
export function createTokenStore({ file, seeds, fetchImpl = fetch, now = Date.now, onError = () => {} }) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* 첫 실행 */
  }
  for (const [lang, seed] of Object.entries(seeds)) {
    if (state[lang]?.seed !== seed) state[lang] = { seed, token: seed, expiresAt: null };
  }

  function persist() {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  persist();

  async function refresh(lang) {
    const url = `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(state[lang].token)}`;
    const res = await fetchImpl(url);
    const json = await res.json();
    if (!res.ok || !json.access_token) throw new Error(`token refresh failed (${lang}): ${res.status}`);
    state[lang] = { ...state[lang], token: json.access_token, expiresAt: now() + json.expires_in * 1000 };
    persist();
  }

  async function refreshDue(thresholdDays = 20) {
    for (const lang of Object.keys(seeds)) {
      const { expiresAt } = state[lang];
      if (expiresAt !== null && expiresAt - now() > thresholdDays * DAY) continue;
      try {
        await refresh(lang);
      } catch (e) {
        onError(lang, e);
      }
    }
  }

  return {
    get: (lang) => state[lang].token,
    expiresAt: (lang) => state[lang]?.expiresAt ?? null,
    refreshDue,
    start(intervalMs = 12 * 60 * 60 * 1000) {
      refreshDue();
      setInterval(refreshDue, intervalMs).unref();
    },
  };
}
