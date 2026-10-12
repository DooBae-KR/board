#!/usr/bin/env node
// 국장 추천 기록과 사후 평가 (읽기 전용: 시세 조회만 하고 주문은 내지 않는다)
//   node --env-file=.env scripts/kr-picks.js pick [--market both|kospi|kosdaq] [--size 30] [--top 3] [--codes 005930,000660] [--report]
//        코스피·코스닥 시가총액 상위 종목 중 우상향 조건에 맞는 종목의 매수가·예상 매도가·손절가를 정해 기록 (시장별로 --top개)
//   node --env-file=.env scripts/kr-picks.js eval [--report]                          기록한 추천을 지금 가격과 비교해 예상 수익 vs 실제 수익을 출력
// 환경변수: KIS_APP_KEY, KIS_APP_SECRET (한국투자증권 Open API), KIS_ENV=demo|real(기본 demo), KR_PICKS_FILE(기본 .kr-picks.json)
//           --report를 쓰려면 HARNESS_API_URL, HARNESS_API_TOKEN. 키·토큰은 출력하지 않는다.
// 이 도구는 과거 가격으로 계산한 참고 구간을 기록할 뿐이며 투자 권유나 수익 보장이 아니다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluateSignal, evaluatePick, DEFAULTS } from './lib/kr-picks.js';

const NAMES = { '005930': '삼성전자', '000660': 'SK하이닉스', '005380': '현대차', '035420': 'NAVER', '105560': 'KB금융', '207940': '삼성바이오로직스', '000270': '기아', '068270': '셀트리온', '005490': 'POSCO홀딩스', '373220': 'LG에너지솔루션' };
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

async function universe(tk, market, size) { // KIS 시가총액 상위(보통주) 목록: 코스피 0001, 코스닥 1001
  const j = await kis('/uapi/domestic-stock/v1/ranking/market-cap', 'FHPST01740000', { fid_input_price_2: '', fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20174', fid_div_cls_code: '1', fid_input_iscd: market === 'kosdaq' ? '1001' : '0001', fid_trgt_cls_code: '0', fid_trgt_exls_cls_code: '0', fid_input_price_1: '', fid_vol_cnt: '' }, tk);
  return (j.output || []).slice(0, size).map((r) => ({ code: r.mksc_shrn_iscd, name: r.hts_kor_isnm, market }));
}
async function pick() {
  const tk = await token(), top = Number(arg('top', 3)) || 3, size = Number(arg('size', 30)) || 30, mk = String(arg('market', 'both'));
  const markets = mk === 'kospi' ? ['kospi'] : mk === 'kosdaq' ? ['kosdaq'] : ['kospi', 'kosdaq'], today = ymd(kst()), skipped = [];
  let list = [];
  if (arg('codes', false)) list = String(arg('codes')).split(',').map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)).map((code) => ({ code, name: NAMES[code] || code, market: 'custom' }));
  else for (const m of markets) { try { list.push(...(await universe(tk, m, size))); } catch (e) { skipped.push({ name: m, s: { reasons: [e.message] } }); } }
  const cands = [];
  for (const u of list) {
    try {
      const [bars, px] = await Promise.all([daily(u.code, tk), price(u.code, tk)]);
      const s = evaluateSignal(bars, px, DEFAULTS);
      (s.ok ? cands : skipped).push({ ...u, px, s, asOf: bars.at(-1)?.d });
    } catch (e) { skipped.push({ ...u, s: { reasons: [e.message] } }); }
  }
  const state = load(), chosen = [];
  for (const m of [...new Set(list.map((u) => u.market))]) {
    cands.filter((c) => c.market === m).sort((a, b) => b.s.score - a.s.score).slice(0, top).forEach((c) => chosen.push(c));
  }
  const fresh = chosen.filter((c) => !state.picks.some((p) => p.code === c.code && p.status === 'open'));
  for (const c of fresh) state.picks.push({ id: `${today}-${c.code}`, code: c.code, name: c.name, market: c.market, date: today, entry: c.s.entry, target: c.s.target, stop: c.s.stop, expectedPct: c.s.expectedPct, status: 'open' });
  writeFileSync(FILE, JSON.stringify(state, null, 1));
  const asOf = [...cands, ...skipped].map((c) => c.asOf).filter(Boolean).sort().at(-1) || '-';
  console.log(`기준: ${list.length}종목 조사(${markets.join('·')}), 일봉 마지막 날짜 ${asOf}, 조회 시각 ${kst().toISOString().slice(0, 16).replace('T', ' ')} KST. 매수가는 조회 시점 가격(장 시작 전이면 전일 종가) 기준이며, 참고용이고 투자 권유가 아닙니다.\n`);
  console.log(fresh.length ? '시장\t종목\t매수가\t예상 매도가\t손절가\t비용 뺀 기대수익' : '조건에 맞는 새 종목이 없습니다.');
  for (const c of fresh) console.log(`${c.market}\t${c.name}(${c.code})\t${won(c.s.entry)}\t${won(c.s.target)}\t${won(c.s.stop)}\t${pct(c.s.expectedPct)}`);
  if (skipped.length) console.log(`\n제외 ${skipped.length}종목 (예: ${skipped.slice(0, 3).map((s) => `${s.name} ${s.s.reasons[0]}`).join(' / ')})`);
  if (arg('report', false)) await putWidget('오늘의 추천', fresh.map((c) => ({ title: `${c.name} (${c.market === 'kosdaq' ? '코스닥' : '코스피'})`, meta: `매수 ${won(c.s.entry)} → 예상 매도 ${won(c.s.target)} · 손절 ${won(c.s.stop)} · 기대 ${pct(c.s.expectedPct)}`, status: 'todo' })).concat(fresh.length ? [] : [{ title: '오늘은 조건에 맞는 종목이 없어요', meta: `${today} 조회`, status: 'todo' }]));
}

async function evalPicks() {
  const state = load(); if (!state.picks.length) return console.log('기록한 추천이 없습니다. 먼저 pick을 실행하세요.');
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
async function report(ok) {
  await putWidget('국장 추천 기록', ok.map(({ p, r }) => ({ title: `${p.name} ${p.date}`, meta: `예상 ${pct(r.expectedPct)} → 실제 ${pct(r.actualPct)}`, status: r.status === '목표 도달' ? 'done' : r.status === '손절' ? 'risk' : 'doing' })));
}
async function putWidget(title, items) { // 하네스 위젯으로 요약만 올린다 (종목명·가격·수익률, 계좌 정보 없음)
  if (!env.HARNESS_API_URL || !env.HARNESS_API_TOKEN) fail('--report에는 HARNESS_API_URL, HARNESS_API_TOKEN이 필요합니다.');
  const res = await fetch(`${env.HARNESS_API_URL.replace(/\/$/, '')}/api/harness/widgets`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.HARNESS_API_TOKEN}` }, body: JSON.stringify({ section: '우리 허브', type: 'list', title, data: { items } }) });
  console.log(res.ok ? `대시보드(${title})에 반영했어요.` : `대시보드 반영 실패 (${res.status})`);
}

const cmd = process.argv[2];
if (cmd === 'pick') await pick(); else if (cmd === 'eval') await evalPicks();
else fail('사용법: node --env-file=.env scripts/kr-picks.js pick|eval [--codes 005930,000660] [--top 3] [--report]');
