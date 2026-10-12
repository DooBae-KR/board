#!/usr/bin/env node
// 국장 추천 기록과 사후 평가 (읽기 전용: 시세 조회만 하고 주문은 내지 않는다)
//   node --env-file=.env scripts/kr-picks.js pick [--codes 005930,000660] [--top 3]   조건에 맞는 종목의 진입가·예상 매도가·손절가를 정해 기록
//   node --env-file=.env scripts/kr-picks.js eval [--report]                          기록한 추천을 지금 가격과 비교해 예상 수익 vs 실제 수익을 출력
// 환경변수: KIS_APP_KEY, KIS_APP_SECRET (한국투자증권 Open API), KIS_ENV=demo|real(기본 demo), KR_PICKS_FILE(기본 .kr-picks.json)
//           --report를 쓰려면 HARNESS_API_URL, HARNESS_API_TOKEN. 키·토큰은 출력하지 않는다.
// 이 도구는 과거 가격으로 계산한 참고 구간을 기록할 뿐이며 투자 권유나 수익 보장이 아니다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluateSignal, evaluatePick, DEFAULTS } from './lib/kr-picks.js';

const NAMES = { '005930': '삼성전자', '000660': 'SK하이닉스', '005380': '현대차', '035420': 'NAVER', '105560': 'KB금융', '207940': '삼성바이오로직스', '000270': '기아', '068270': '셀트리온', '005490': 'POSCO홀딩스', '373220': 'LG에너지솔루션' };
const DEFAULT_CODES = Object.keys(NAMES);
const env = process.env, kisEnv = env.KIS_ENV === 'real' ? 'real' : 'demo';
const BASE = env.KIS_BASE || (kisEnv === 'real' ? 'https://openapi.koreainvestment.com:9443' : 'https://openapivts.koreainvestment.com:29443');
const FILE = env.KR_PICKS_FILE || '.kr-picks.json', TOKEN_FILE = '.kis-token.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const fail = (m) => { console.error(m); process.exit(1); };
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

async function token() {
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) fail('환경변수 KIS_APP_KEY, KIS_APP_SECRET이 필요합니다 (한국투자증권 Open API 앱키).');
  try { const t = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')); if (t.env === kisEnv && t.base === BASE && Date.parse(t.expires) > Date.now() + 600e3) return t.token; } catch { /* 새로 받는다 */ }
  const res = await fetch(`${BASE}/oauth2/tokenP`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', appkey: env.KIS_APP_KEY, appsecret: env.KIS_APP_SECRET }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) fail(`토큰 발급 실패 (${res.status}): ${j.error_description || j.msg1 || '앱키·시크릿과 KIS_ENV(demo/real)를 확인하세요'}`);
  writeFileSync(TOKEN_FILE, JSON.stringify({ env: kisEnv, base: BASE, token: j.access_token, expires: String(j.access_token_token_expired).replace(' ', 'T') + '+09:00' }), { mode: 0o600 });
  return j.access_token;
}
async function kis(path, trId, params, tk) {
  await sleep(600); // 모의서버는 초당 호출 수가 적다
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${tk}`, appkey: env.KIS_APP_KEY, appsecret: env.KIS_APP_SECRET, tr_id: trId, custtype: 'P' } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.rt_cd !== '0') throw new Error(`${trId} 실패: ${j.msg1 || res.status}`);
  return j;
}
const price = async (code, tk) => Number((await kis('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code }, tk)).output.stck_prpr);
async function daily(code, tk, days = 150) { // 일봉, 오래된 값 → 최신 값 (원주가가 아닌 수정주가 기준)
  const to = kst(), from = new Date(to.getTime() - days * 864e5);
  const j = await kis('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', 'FHKST03010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code, FID_INPUT_DATE_1: ymd(from), FID_INPUT_DATE_2: ymd(to), FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '0' }, tk);
  return (j.output2 || []).filter((r) => r.stck_bsop_date).map((r) => ({ d: r.stck_bsop_date, o: +r.stck_oprc, h: +r.stck_hgpr, l: +r.stck_lwpr, c: +r.stck_clpr, v: +r.acml_vol })).sort((a, b) => a.d.localeCompare(b.d));
}
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { picks: [] });
const won = (n) => Math.round(n).toLocaleString('ko-KR');
const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

async function pick() {
  const codes = String(arg('codes', DEFAULT_CODES.join(','))).split(',').map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s)), top = Number(arg('top', 3)) || 3, tk = await token();
  const today = ymd(kst()), cands = [], skipped = [];
  for (const code of codes) {
    try {
      const [bars, px] = await Promise.all([daily(code, tk), price(code, tk)]);
      const s = evaluateSignal(bars, px, DEFAULTS);
      (s.ok ? cands : skipped).push({ code, name: NAMES[code] || code, px, s, asOf: bars.at(-1)?.d });
    } catch (e) { skipped.push({ code, name: NAMES[code] || code, s: { reasons: [e.message] } }); }
  }
  cands.sort((a, b) => b.s.score - a.s.score);
  const state = load(), chosen = cands.slice(0, top).filter((c) => !state.picks.some((p) => p.code === c.code && p.status === 'open'));
  for (const c of chosen) state.picks.push({ id: `${today}-${c.code}`, code: c.code, name: c.name, date: today, entry: c.s.entry, target: c.s.target, stop: c.s.stop, expectedPct: c.s.expectedPct, status: 'open' });
  writeFileSync(FILE, JSON.stringify(state, null, 1));
  console.log(`기준: 코스피 대형주 ${codes.length}종목, 일봉 마지막 날짜 ${cands[0]?.asOf || '-'}, 조회 시각 ${kst().toISOString().slice(0, 16).replace('T', ' ')} KST. 참고용이며 투자 권유가 아닙니다.\n`);
  console.log(chosen.length ? '종목\t매수가\t예상 매도가\t손절가\t비용 뺀 기대수익' : '조건에 맞는 새 종목이 없습니다.');
  for (const c of chosen) console.log(`${c.name}(${c.code})\t${won(c.s.entry)}\t${won(c.s.target)}\t${won(c.s.stop)}\t${pct(c.s.expectedPct)}`);
  if (skipped.length) console.log('\n제외: ' + skipped.map((s) => `${s.name} (${s.s.reasons[0]})`).join(', '));
}

async function evalPicks() {
  const state = load(); if (!state.picks.length) fail('기록한 추천이 없습니다. 먼저 pick을 실행하세요.');
  const tk = await token(), rows = [];
  for (const p of state.picks) {
    try {
      if (p.status !== 'open') { rows.push({ p, r: { status: p.status === 'target' ? '목표 도달' : '손절', price: p.closePrice, actualPct: p.actualPct, expectedPct: p.expectedPct, gapPct: p.actualPct - p.expectedPct } }); continue; }
      const [bars, px] = await Promise.all([daily(p.code, tk, 90), price(p.code, tk)]);
      const r = evaluatePick(p, px, bars.filter((b) => b.d > p.date));
      if (r.status !== '보유 중') Object.assign(p, { status: r.status === '목표 도달' ? 'target' : 'stop', closePrice: r.price, closedAt: r.date, actualPct: r.actualPct });
      rows.push({ p, r });
    } catch (e) { rows.push({ p, err: e.message }); }
  }
  writeFileSync(FILE, JSON.stringify(state, null, 1));
  console.log('종목\t추천일\t매수가\t예상 매도가\t예상 수익\t현재/종료가\t실제 수익\t차이\t상태');
  for (const { p, r, err } of rows) console.log(err ? `${p.name}\t${p.date}\t${won(p.entry)}\t${won(p.target)}\t${pct(p.expectedPct)}\t조회 실패: ${err}` : `${p.name}\t${p.date}\t${won(p.entry)}\t${won(p.target)}\t${pct(r.expectedPct)}\t${won(r.price)}\t${pct(r.actualPct)}\t${pct(r.gapPct)}\t${r.status}${r.note ? ' (' + r.note + ')' : ''}`);
  const ok = rows.filter((x) => x.r), n = ok.length;
  if (n) console.log(`\n평균 예상 ${pct(ok.reduce((t, x) => t + x.r.expectedPct, 0) / n)} · 평균 실제 ${pct(ok.reduce((t, x) => t + x.r.actualPct, 0) / n)} (왕복 비용 반영, ${n}건). 표본이 적으면 의미가 작습니다.`);
  if (arg('report', false)) await report(ok);
}
async function report(ok) { // 하네스 위젯으로 요약만 올린다 (종목명·수익률, 계좌 정보 없음)
  if (!env.HARNESS_API_URL || !env.HARNESS_API_TOKEN) fail('--report에는 HARNESS_API_URL, HARNESS_API_TOKEN이 필요합니다.');
  const items = ok.map(({ p, r }) => ({ title: `${p.name} ${p.date}`, meta: `예상 ${pct(r.expectedPct)} → 실제 ${pct(r.actualPct)}`, status: r.status === '목표 도달' ? 'done' : r.status === '손절' ? 'risk' : 'doing' }));
  const res = await fetch(`${env.HARNESS_API_URL.replace(/\/$/, '')}/api/harness/widgets`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.HARNESS_API_TOKEN}` }, body: JSON.stringify({ section: '우리 허브', type: 'list', title: '국장 추천 기록', data: { items } }) });
  console.log(res.ok ? '대시보드에 반영했어요.' : `대시보드 반영 실패 (${res.status})`);
}

const cmd = process.argv[2];
if (cmd === 'pick') await pick(); else if (cmd === 'eval') await evalPicks();
else fail('사용법: node --env-file=.env scripts/kr-picks.js pick|eval [--codes 005930,000660] [--top 3] [--report]');
