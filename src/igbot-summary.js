// 인스타 DM 봇(igbot_* 테이블)의 최근 N일 퍼널 집계와 경고 계산. 순수 함수라 DB 없이 테스트한다.
// 토큰 값은 다루지 않는다: 입력은 만료일·갱신 시각만 담은 행이다 (CLAUDE.md 2-4).
const DAY = 86_400_000;
export const FUNNEL_EVENTS = ['matched', 'link_direct', 'asked', 'click_ok', 'click_retry', 'error'];
export const LANGS = ['ko', 'en'];
export const EXPIRY_WARN_DAYS = 7;   // 만료 7일 이내면 경고
export const EXPIRY_BAD_DAYS = 3;    // 3일 이내(또는 이미 만료)면 위험
const REFRESH_FAIL_RE = /token refresh failed/i;
const REFRESH_WINDOW_MS = 2 * DAY;   // 갱신은 12시간마다 재시도하므로 이틀 안의 실패를 본다
const WEBHOOK_WINDOW_MS = 1 * DAY;

const zero = () => Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]));

/**
 * @param {{ events?: {at:string,lang:string,event:string,detail?:string|null}[], tokens?: {lang:string,expires_at:string|null,updated_at:string|null}[] }} input
 * @param {{ now?: number, days?: number }} [opt]
 */
export function summarizeIgbot({ events = [], tokens = [] } = {}, { now = Date.now(), days = 7 } = {}) {
  const since = now - days * DAY;
  const accounts = {};
  const errors = [];
  const refreshFails = {}; // lang -> 가장 최근 갱신 실패 시각(ms)
  let webhookErrors = 0, lastWebhookError = 0;

  for (const e of events) {
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at > now) continue;
    const inRange = at >= since;
    if (inRange && LANGS.includes(e.lang) && FUNNEL_EVENTS.includes(e.event)) {
      accounts[e.lang] ??= zero();
      accounts[e.lang][e.event]++;
    }
    if (e.event !== 'error') continue;
    const isRefresh = REFRESH_FAIL_RE.test(e.detail ?? '');
    if (inRange) errors.push({ at: e.at, lang: e.lang, kind: isRefresh ? 'refresh' : 'webhook', detail: String(e.detail ?? '').slice(0, 200) });
    if (isRefresh && now - at <= REFRESH_WINDOW_MS) refreshFails[e.lang] = Math.max(refreshFails[e.lang] ?? 0, at);
    if (!isRefresh && now - at <= WEBHOOK_WINDOW_MS) { webhookErrors++; lastWebhookError = Math.max(lastWebhookError, at); }
  }
  errors.sort((a, b) => (a.at < b.at ? 1 : -1));

  const tokenInfo = {};
  for (const t of tokens) {
    if (!LANGS.includes(t.lang)) continue;
    const exp = t.expires_at ? Date.parse(t.expires_at) : NaN;
    tokenInfo[t.lang] = {
      expiresAt: Number.isFinite(exp) ? new Date(exp).toISOString() : null,
      daysLeft: Number.isFinite(exp) ? Math.floor((exp - now) / DAY) : null,
      updatedAt: t.updated_at ?? null,
    };
  }

  const alerts = [];
  for (const lang of LANGS) {
    const t = tokenInfo[lang];
    if (t && t.daysLeft !== null && t.daysLeft <= EXPIRY_WARN_DAYS) {
      alerts.push({ code: 'token_expiry', lang, level: t.daysLeft <= EXPIRY_BAD_DAYS ? 'bad' : 'warn', daysLeft: t.daysLeft, message: t.daysLeft < 0 ? '토큰이 만료됐어요' : `토큰이 ${t.daysLeft}일 뒤 만료돼요` });
    }
    // 실패 뒤에 토큰이 새로 저장됐으면(갱신 성공) 해결된 것으로 본다
    const failedAt = refreshFails[lang];
    const upd = t?.updatedAt ? Date.parse(t.updatedAt) : 0;
    if (failedAt && !(upd > failedAt)) alerts.push({ code: 'refresh_failed', lang, level: 'bad', at: new Date(failedAt).toISOString(), message: '토큰 갱신에 실패했어요' });
  }
  if (webhookErrors) alerts.push({ code: 'webhook_error', lang: null, level: 'warn', count: webhookErrors, at: new Date(lastWebhookError).toISOString(), message: `최근 24시간 웹훅 처리 오류 ${webhookErrors}건` });
  const rank = { bad: 0, warn: 1 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);

  const shown = LANGS.filter((l) => accounts[l] || tokenInfo[l]);
  const rows = Object.fromEntries(shown.map((l) => [l, accounts[l] ?? zero()]));
  const total = zero();
  for (const l of shown) for (const k of FUNNEL_EVENTS) total[k] += rows[l][k];
  return { days, since: new Date(since).toISOString(), accounts: rows, total, tokens: tokenInfo, alerts, errors: errors.slice(0, 10), errorCount: errors.length };
}
