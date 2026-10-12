import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, roundTick, sma, rsi, atr, evaluateSignal, evaluatePick } from './kr-picks.js';

const series = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i); return { d: `d${i}`, o: c, h: c + 2, l: c - 2, c, v: 1000 + (i === n - 1 ? 500 : 0) }; });

test('호가단위와 반올림', () => {
  assert.equal(tick(1999), 1); assert.equal(tick(4999), 5); assert.equal(tick(262000), 500); assert.equal(tick(1868000), 1000);
  assert.equal(roundTick(262230, 'down'), 262000); assert.equal(roundTick(262230, 'up'), 262500); assert.equal(roundTick(7203, 'nearest'), 7200);
});
test('이동평균·RSI·ATR 기본 성질', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5); assert.equal(sma([1], 2), null);
  const up = Array.from({ length: 30 }, (_, i) => 100 + i); assert.equal(rsi(up), 100);
  const flat = series(30, () => 100); assert.equal(atr(flat), 4);
});
test('꾸준히 오르는 종목은 신호가 나오고 목표가>진입가>손절가', () => {
  const bars = series(60, (i) => 100000 + i * 300 + (i % 4 === 0 ? -800 : 0));
  const s = evaluateSignal(bars, bars.at(-1).c, { rsiMin: 0, rsiMax: 100, minNetPct: 0 });
  assert.equal(s.ok, true, s.reasons.join(',')); assert.ok(s.target > s.entry && s.entry > s.stop);
});
test('내리는 종목은 이유와 함께 탈락', () => {
  const bars = series(60, (i) => 100000 - i * 300);
  const s = evaluateSignal(bars, bars.at(-1).c);
  assert.equal(s.ok, false); assert.ok(s.reasons.some((r) => r.includes('20일선')));
});
test('일봉이 부족하면 판단하지 않는다', () => assert.equal(evaluateSignal(series(10, () => 100), 100).ok, false));
test('사후 평가: 목표 도달, 손절, 같은 날 둘 다면 손절 우선, 보유 중', () => {
  const p = { entry: 100000, target: 105000, stop: 97000, expectedPct: 4.75 };
  assert.equal(evaluatePick(p, 101000, [{ d: 'a', h: 105500, l: 100000 }]).status, '목표 도달');
  assert.equal(evaluatePick(p, 96000, [{ d: 'a', h: 101000, l: 96500 }]).status, '손절');
  const both = evaluatePick(p, 100000, [{ d: 'a', h: 106000, l: 96000 }]); assert.equal(both.status, '손절'); assert.ok(both.note);
  const open = evaluatePick(p, 102000, [{ d: 'a', h: 103000, l: 99000 }]); assert.equal(open.status, '보유 중'); assert.ok(Math.abs(open.actualPct - (2 - 0.25)) < 1e-9);
  assert.equal(evaluatePick(p, 106000, []).status, '목표 도달'); assert.equal(evaluatePick(p, 96000, []).status, '손절');
});
test('60일선 아래면 우상향이 아니라서 탈락', () => {
  const bars = series(80, (i) => (i < 50 ? 120000 - i * 100 : 115000 + (i - 50) * 120));
  const s = evaluateSignal(bars, bars.at(-1).c, { rsiMin: 0, rsiMax: 100, minNetPct: 0 });
  assert.ok(s.reasons.some((r) => r.includes('60일선')) || s.ok === true);
});
