// 국장 추천 계산과 사후 평가. 네트워크·파일 접근 없이 숫자만 다루는 순수 함수라서 테스트할 수 있다.
// 이 값은 과거 가격으로 계산한 참고 구간이며 투자 권유나 수익 보장이 아니다 (agents/kr-trader.md).

export const COST_PCT = 0.25; // 왕복 비용 가정(%): 수수료 + 매도 시 증권거래세. 증권사·시기에 따라 다르므로 환경변수로 바꿀 수 있게 CLI에서 받는다.

/** 코스피 호가단위 (2023년 개편 기준). 코스닥·ETF는 다를 수 있다. */
export function tick(price) {
  return price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10 : price < 50000 ? 50 : price < 200000 ? 100 : price < 500000 ? 500 : 1000;
}
export const roundTick = (p, mode = 'nearest') => { const t = tick(p), q = p / t; return (mode === 'down' ? Math.floor(q) : mode === 'up' ? Math.ceil(q) : Math.round(q)) * t; };

export const sma = (v, n, end = v.length) => (end >= n ? v.slice(end - n, end).reduce((a, b) => a + b, 0) / n : null);

/** Wilder RSI. v는 오래된 값 → 최신 값 순서 */
export function rsi(v, n = 14) {
  if (v.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; d >= 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Wilder ATR. bars: [{h,l,c}] 오래된 값 → 최신 값 */
export function atr(bars, n = 14) {
  if (bars.length <= n) return null;
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)));
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

export const DEFAULTS = { rsiMin: 45, rsiMax: 70, volMult: 1.0, stopAtr: 1.5, targetAtr: 2.5, minNetPct: 1.5, costPct: COST_PCT };

/**
 * 한 종목의 신호를 계산한다. bars: 일봉 [{d,o,h,l,c,v}] 오래된 값 → 최신 값, price: 지금 가격
 * 반환: { ok, reasons[], entry, target, stop, expectedPct(비용 뺀 목표 수익률), riskPct, score }
 */
export function evaluateSignal(bars, price, opt = {}) {
  const o = { ...DEFAULTS, ...opt }, reasons = [];
  if (bars.length < 40) return { ok: false, reasons: ['일봉이 40개 미만'] };
  if (!(price > 0)) return { ok: false, reasons: ['현재가 없음'] };
  const c = bars.map((b) => b.c), ma20 = sma(c, 20), ma20Prev = sma(c, 20, c.length - 5), r = rsi(c), a = atr(bars);
  const volAvg = sma(bars.map((b) => b.v), 20, bars.length - 1), volNow = bars.at(-1).v;
  if (price <= ma20) reasons.push('20일선 아래');
  if (!(ma20 > ma20Prev)) reasons.push('20일선이 오르는 중이 아님');
  if (r == null || r < o.rsiMin || r > o.rsiMax) reasons.push(`RSI ${r == null ? '없음' : r.toFixed(0)}가 ${o.rsiMin}~${o.rsiMax} 밖`);
  if (volAvg && volNow < volAvg * o.volMult) reasons.push('거래량이 20일 평균보다 적음');
  const entry = roundTick(price, 'down'), stop = roundTick(entry - o.stopAtr * a, 'down'), target = roundTick(entry + o.targetAtr * a, 'up');
  const grossPct = (target / entry - 1) * 100, expectedPct = grossPct - o.costPct, riskPct = (1 - stop / entry) * 100 + o.costPct;
  if (expectedPct < o.minNetPct) reasons.push(`비용 뺀 기대 수익 ${expectedPct.toFixed(1)}%가 ${o.minNetPct}% 미만`);
  const score = (r == null ? 0 : 100 - Math.abs(r - 58)) + (ma20Prev ? ((ma20 / ma20Prev - 1) * 1000) : 0) + expectedPct / Math.max(riskPct, 0.1);
  return { ok: reasons.length === 0, reasons, entry, target, stop, expectedPct, riskPct, rsi: r, atr: a, ma20, score };
}

/**
 * 추천 하나를 지금 가격과 이후 일봉으로 평가한다.
 * bars: 추천일 이후의 일봉(추천일 다음 거래일부터). 같은 날 목표가와 손절가에 모두 닿았으면 순서를 알 수 없어 손절을 먼저로 본다(보수적).
 */
export function evaluatePick(pick, price, barsAfter = [], costPct = COST_PCT) {
  for (const b of barsAfter) {
    const hitStop = b.l <= pick.stop, hitTarget = b.h >= pick.target;
    if (hitStop) return result('손절', pick.stop, b.d, hitTarget ? '같은 날 목표가에도 닿았지만 손절을 먼저로 봄' : '');
    if (hitTarget) return result('목표 도달', pick.target, b.d, '');
  }
  if (price >= pick.target) return result('목표 도달', pick.target, null, '현재가가 목표가 이상');
  if (price <= pick.stop) return result('손절', pick.stop, null, '현재가가 손절가 이하');
  return result('보유 중', price, null, '');
  function result(status, px, date, note) {
    const actualPct = (px / pick.entry - 1) * 100 - costPct;
    return { status, price: px, date, note, actualPct, expectedPct: pick.expectedPct, gapPct: actualPct - pick.expectedPct };
  }
}
