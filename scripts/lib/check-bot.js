// 봇 사전 점검 로직. 환경변수는 이름의 설정 여부만 보고, 값은 결과에 넣지 않는다.
// 네트워크(fetch)는 주입받아 테스트에서 가짜로 바꾼다.
import { validateRepos } from '../../src/repos.js';

const GRAPH = 'https://graph.instagram.com/v23.0';
export const STATUS = { pass: '통과', warn: '경고', fail: '실패', unknown: '확인못함' };

const set = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';
const row = (group, name, status, detail = '') => ({ group, name, status, detail });

export function checkEnv(env) {
  const rows = [];
  const need = (k, status, why) => rows.push(set(env, k) ? row('환경변수', k, 'pass', '설정됨') : row('환경변수', k, status, `비어 있음 - ${why}`));
  need('VERIFY_TOKEN', 'fail', '웹훅 확인 토큰');
  need('APP_SECRET', 'fail', '없으면 웹훅 POST가 거부됨');
  need('SUPABASE_URL', 'fail', '토큰·중복 방지 저장소');
  need('SUPABASE_SERVICE_ROLE_KEY', 'fail', '서버 전용 비밀 키');
  need('DASHBOARD_TOKEN', 'fail', '대시보드 로그인/세션 키');
  need('HARNESS_API_TOKEN', 'warn', '에이전트 보고 API용(봇 동작과는 무관)');
  if (env.VERIFY_TOKEN === 'change-me') rows.push(row('환경변수', 'VERIFY_TOKEN 값', 'warn', '예시 값(change-me) 그대로입니다. 추측 가능한 값은 피하세요'));
  if (set(env, 'DASHBOARD_TOKEN') && env.DASHBOARD_TOKEN === env.HARNESS_API_TOKEN) rows.push(row('환경변수', 'DASHBOARD_TOKEN vs HARNESS_API_TOKEN', 'warn', '두 값이 같습니다. 서로 다르게 하세요'));

  let complete = 0;
  for (const [lang, key] of [['ko', 'KO'], ['en', 'EN']]) {
    const id = set(env, `IG_${key}_USER_ID`), tok = set(env, `IG_${key}_ACCESS_TOKEN`);
    if (id && tok) { complete++; rows.push(row('계정', `IG_${key}_*`, 'pass', `${lang} 계정 완전함(USER_ID, ACCESS_TOKEN)`)); }
    else if (id || tok) rows.push(row('계정', `IG_${key}_*`, 'fail', `${id ? 'ACCESS_TOKEN' : 'USER_ID'}만 비어 있음(반쪽 설정)`));
    else rows.push(row('계정', `IG_${key}_*`, 'warn', `${lang} 계정 미설정(해당 언어 댓글은 처리되지 않음)`));
  }
  if (!complete) rows.push(row('계정', '봇 계정', 'fail', '완전한 계정이 하나도 없음(IG_KO_* 또는 IG_EN_*)'));
  return rows;
}

export function checkRepos(data) {
  const rows = [];
  let repos;
  try { repos = validateRepos(data); rows.push(row('영상', 'repos.json 형식', 'pass', `${repos.length}개 항목`)); }
  catch (e) { return [row('영상', 'repos.json 형식', 'fail', e.message)]; }

  const ph = repos.filter((r) => !/^\d+$/.test(r.mediaId));
  rows.push(ph.length
    ? row('영상', 'placeholder mediaId', 'warn', `${ph.length}개 아직 숫자가 아님: ${ph.map((r) => r.id).join(', ')}`)
    : row('영상', 'placeholder mediaId', 'pass', '없음'));

  const hangul = repos.some((r) => /[가-힣]/.test(r.keyword ?? ''));
  const latin = repos.some((r) => /^[\x20-\x7e]+$/.test(r.keyword ?? '') && /[a-z]/i.test(r.keyword));
  rows.push(hangul ? row('영상', '한국어 키워드', 'pass', '있음') : row('영상', '한국어 키워드', 'warn', '한글 keyword를 가진 항목이 없음'));
  rows.push(latin ? row('영상', '영어 키워드', 'pass', '있음') : row('영상', '영어 키워드', 'warn', '영문 keyword를 가진 항목이 없음'));

  // 같은 mediaId 안에서만 키워드가 경쟁한다(matchRepo는 첫 번째 항목을 고름)
  const byMedia = new Map();
  for (const r of repos) byMedia.set(r.mediaId, [...(byMedia.get(r.mediaId) ?? []), r]);
  const risks = [], dups = [];
  for (const list of byMedia.values()) {
    list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
      const ka = (a.keyword ?? '').toLowerCase(), kb = (b.keyword ?? '').toLowerCase();
      if (ka === kb) dups.push(`${a.id}/${b.id}(${ka || '키워드 없음'})`);
      else if (!ka || !kb || ka.includes(kb) || kb.includes(ka)) risks.push(`${a.id}/${b.id}`);
    }));
  }
  rows.push(dups.length ? row('영상', 'keyword 중복', 'fail', `같은 영상에 같은 keyword: ${dups.join(', ')} (뒤 항목은 매칭 안 됨)`)
    : risks.length ? row('영상', 'keyword 중복 위험', 'warn', `같은 영상에서 한쪽 keyword가 다른 쪽을 포함하거나 비어 있음: ${risks.join(', ')}`)
    : row('영상', 'keyword 중복 위험', 'pass', '없음'));
  return rows;
}

const unreachable = (e) => `네트워크 오류: ${e?.cause?.code ?? e?.name ?? 'error'}`;

async function graphGet(fetchImpl, path, token) {
  const res = await fetchImpl(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  let json = {};
  try { json = await res.json(); } catch { /* 본문 없음 */ }
  return { ok: res.ok, status: res.status, json };
}

const apiErr = (r) => `HTTP ${r.status}${r.json?.error?.message ? ` - ${String(r.json.error.message).slice(0, 120)}` : ''}`;

export async function checkOnline({ env, fetchImpl = fetch, url }) {
  const rows = [];
  for (const [lang, key] of [['ko', 'KO'], ['en', 'EN']]) {
    const id = env[`IG_${key}_USER_ID`], token = env[`IG_${key}_ACCESS_TOKEN`];
    if (!id || !token) continue;
    const g = `계정 ${lang}`;
    try {
      const me = await graphGet(fetchImpl, 'me?fields=user_id,username', token);
      if (!me.ok) { rows.push(row(g, '토큰 유효성 /me', 'fail', `${apiErr(me)} (만료·권한 확인)`)); continue; }
      const same = [me.json.user_id, me.json.id].map(String).includes(String(id));
      rows.push(row(g, '토큰 유효성 /me', 'pass', `@${me.json.username ?? '?'}`));
      rows.push(same ? row(g, 'USER_ID 일치', 'pass', '토큰 소유 계정과 같음') : row(g, 'USER_ID 일치', 'warn', 'IG_USER_ID가 토큰 소유 계정과 다름'));
      const sub = await graphGet(fetchImpl, `${id}/subscribed_apps`, token);
      if (!sub.ok) { rows.push(row(g, '웹훅 구독', 'fail', apiErr(sub))); continue; }
      const fields = new Set((sub.json.data ?? []).flatMap((a) => a.subscribed_fields ?? []));
      for (const f of ['comments', 'messages']) {
        rows.push(fields.has(f) ? row(g, `구독 ${f}`, 'pass', '구독 중') : row(g, `구독 ${f}`, 'fail', '구독되지 않음(subscribed_apps 설정 필요)'));
      }
    } catch (e) { rows.push(row(g, '온라인 점검', 'unknown', unreachable(e))); }
  }
  if (url) {
    const base = url.replace(/\/+$/, '');
    if (!env.VERIFY_TOKEN) rows.push(row('웹훅', '핸드셰이크', 'unknown', 'VERIFY_TOKEN이 없어 시도하지 않음'));
    else {
      try {
        const challenge = `chk${Date.now()}`;
        const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': env.VERIFY_TOKEN, 'hub.challenge': challenge });
        const res = await fetchImpl(`${base}/webhook?${q}`);
        const body = await res.text();
        rows.push(res.ok && body === challenge ? row('웹훅', '핸드셰이크', 'pass', 'challenge를 돌려줌')
          : row('웹훅', '핸드셰이크', 'fail', `HTTP ${res.status}, challenge 불일치(배포 환경변수 VERIFY_TOKEN이 이 값과 같은지 확인)`));
      } catch (e) { rows.push(row('웹훅', '핸드셰이크', 'unknown', unreachable(e))); }
    }
  }
  return rows;
}

const SECRET_KEYS = ['VERIFY_TOKEN', 'APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'DASHBOARD_TOKEN', 'HARNESS_API_TOKEN', 'IG_KO_ACCESS_TOKEN', 'IG_EN_ACCESS_TOKEN'];

/** 출력 직전 안전장치: 비밀값이 혹시 문자열에 섞였으면 가린다 */
export function redact(text, env) {
  let out = text;
  for (const k of SECRET_KEYS) if (set(env, k) && env[k].length >= 6) out = out.split(env[k]).join('***');
  return out;
}

export function render(rows, env = {}) {
  const lines = ['항목 점검 결과', ''];
  let group = '';
  for (const r of rows) {
    if (r.group !== group) { group = r.group; lines.push(`[${group}]`); }
    lines.push(`  ${STATUS[r.status]} | ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  }
  const c = (s) => rows.filter((r) => r.status === s).length;
  lines.push('', `요약: 통과 ${c('pass')} / 경고 ${c('warn')} / 실패 ${c('fail')} / 확인못함 ${c('unknown')}`);
  return redact(lines.join('\n'), env);
}

export async function runChecks({ env, reposData, online = false, url, fetchImpl }) {
  const rows = [...checkEnv(env), ...checkRepos(reposData)];
  if (online || url) rows.push(...await checkOnline({ env, fetchImpl, url }));
  return rows;
}

export const exitCode = (rows) => (rows.some((r) => r.status === 'fail') ? 1 : 0);
