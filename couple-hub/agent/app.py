"""미장 분석 에이전트 — 무료 시세(yfinance) + gs-quant 지표(gs_quant.timeseries)로
매수가/매도가 '참고 구간'을 계산한다. 투자 권유가 아니며 수익을 보장하지 않는다.

실행: uvicorn app:app --port 8000
  GET /analyze?symbol=AAPL           한 종목 분석
  GET /screen?symbols=AAPL,MSFT,NVDA 여러 종목을 점수순으로
  GET /analyze?symbol=AAPL&demo=1    합성 데이터(네트워크 없이 동작 확인)
"""
import math
import time
import zlib

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
# gs-quant: 기관 자격증명 없이도 pd.Series 입력 계산 함수는 로컬에서 동작한다
from gs_quant.timeseries import (bollinger_bands, macd, moving_average,
                                 relative_strength_index, volatility)

DISCLAIMER = ("참고용 기술적 분석 결과이며 투자 권유가 아닙니다. 과거 지표는 미래 수익을 보장하지 않고, "
              "투자 판단과 손실 책임은 본인에게 있습니다.")
app = FastAPI(title="couple-hub stock agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

_cache: dict = {}
TTL = 600  # 10분


def fetch_prices(symbol: str, demo: bool = False) -> pd.Series:
    if demo:  # 네트워크 없이 테스트용
        rng = np.random.default_rng(zlib.crc32(symbol.encode()))  # 프로세스와 무관한 안정 시드
        idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=320)
        return pd.Series(100 * np.exp(np.cumsum(rng.normal(0.0004, 0.014, len(idx)))), index=idx, name=symbol)
    import yfinance as yf
    df = yf.Ticker(symbol).history(period="2y", auto_adjust=True)
    if df.empty or "Close" not in df:
        raise ValueError(f"{symbol}: 시세를 충분히 가져오지 못했습니다 (티커 확인)")
    return _clean(symbol, df["Close"])


MIN_BARS = 220  # 200일선 + 여유


def _clean(symbol: str, close: pd.Series) -> pd.Series:
    """NaN/비양수 제거, 인덱스를 tz-naive 일 단위로 통일(tz-aware/naive 모두 허용), 길이 검증."""
    s = pd.to_numeric(close, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    s = s[s > 0]
    idx = pd.DatetimeIndex(s.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    s = pd.Series(s.to_numpy(dtype=float), index=idx.normalize(), name=symbol)
    s = s[~s.index.duplicated(keep="last")].sort_index()
    if len(s) < MIN_BARS:
        raise ValueError(f"{symbol}: 유효 시세가 부족합니다 ({len(s)}개 < {MIN_BARS})")
    return s


def _f(x, nd=2):
    x = float(x)
    return None if math.isnan(x) else round(x, nd)


def analyze_series(symbol: str, close: pd.Series) -> dict:
    close = _clean(symbol, close)
    last = float(close.iloc[-1])
    ma20, ma50, ma200 = (moving_average(close, w) for w in (20, 50, 200))
    rsi = relative_strength_index(close)           # 기본 14일
    bb = bollinger_bands(close, 20)              # 컬럼 0=하단, 1=상단 (20일, 2σ) — 창 미지정 시 전체 기간이라 명시
    bb_lo, bb_hi = bb.iloc[:, 0], bb.iloc[:, 1]
    macd_s = macd(close, 12, 26, 9)              # MACD 히스토그램(12,26,9)
    vol_ann = float(volatility(close, 21).iloc[-1])  # 21거래일 창, 연환산 %
    if math.isnan(vol_ann) or vol_ann < 0:
        raise ValueError(f"{symbol}: 변동성을 계산할 수 없습니다")
    sigma10 = vol_ann / 100 * math.sqrt(10 / 252)  # 10거래일 기대 변동폭 (평평한 시계열이면 0)

    m20, m50, m200 = float(ma20.iloc[-1]), float(ma50.iloc[-1]), float(ma200.iloc[-1])
    r, mh, mh_prev = float(rsi.iloc[-1]), float(macd_s.iloc[-1]), float(macd_s.iloc[-2])
    lo, hi = float(bb_lo.iloc[-1]), float(bb_hi.iloc[-1])
    if any(math.isnan(v) for v in (m20, m50, m200, r, mh, mh_prev, lo, hi)):
        raise ValueError(f"{symbol}: 지표 계산 결과가 유효하지 않습니다")

    score, why = 0, []
    def sig(cond, pts, text):
        nonlocal score
        if cond:
            score += pts
            why.append(("+" if pts > 0 else "") + f"{pts} {text}")
    sig(last > m50, 1, "종가가 50일선 위")
    sig(last < m50, -1, "종가가 50일선 아래")
    sig(m50 > m200, 1, "50일선이 200일선 위(장기 상승 배열)")
    sig(m50 < m200, -1, "50일선이 200일선 아래(장기 하락 배열)")
    sig(mh > 0 and mh > mh_prev, 1, "MACD 히스토그램 양수·확대")
    sig(mh < 0 and mh < mh_prev, -1, "MACD 히스토그램 음수·확대")
    sig(vol_ann > 0 and r < 30, 1, f"RSI {r:.0f} 과매도권(반등 후보)")
    sig(vol_ann > 0 and r > 70, -1, f"RSI {r:.0f} 과매수권(과열)")
    sig(last > hi, -1, "볼린저 상단 돌파(단기 과열)")
    sig(last < lo, 1, "볼린저 하단 이탈(단기 낙폭 과대)")

    uptrend = m50 > m200 and last > m50
    # 매수 참고가: 상승 추세면 20일선 눌림목, 아니면 볼린저 하단 부근
    buy = min(last, m20) if uptrend else min(last, lo)
    # 매도 참고가: 볼린저 상단과 '매수가 + 1.5×10일 변동폭' 중 높은 쪽 / 손절 참고가: 매수가 - 1.5×10일 변동폭
    target = max(hi, buy * (1 + 1.5 * sigma10))
    stop = buy * (1 - 1.5 * sigma10)
    verdict = "매수 우위" if score >= 3 else "관망/중립" if score >= 0 else "주의(하락 우위)"

    tail = close.iloc[-120:].index
    series = {
        "dates": [d.strftime("%Y-%m-%d") for d in tail],
        "close": [_f(v) for v in close.loc[tail]],
        "ma20": [_f(v) for v in ma20.loc[tail]],
        "bb_lo": [_f(v) for v in bb_lo.loc[tail]],
        "bb_hi": [_f(v) for v in bb_hi.loc[tail]],
    }
    return {
        "symbol": symbol, "as_of": close.index[-1].strftime("%Y-%m-%d"), "last": _f(last),
        "verdict": verdict, "score": score, "reasons": why,
        "buy_price": _f(buy), "target_price": _f(target), "stop_price": _f(stop),
        "reward_risk": _f((target - buy) / (buy - stop)) if buy > stop else None,
        "indicators": {"rsi14": _f(r), "ma20": _f(m20), "ma50": _f(m50), "ma200": _f(m200),
                       "macd_hist": _f(mh, 3), "vol_annual_pct": _f(vol_ann), "bb_low": _f(lo), "bb_high": _f(hi)},
        "series": series, "disclaimer": DISCLAIMER,
        "method": "gs_quant.timeseries 지표(이동평균·RSI·볼린저·MACD·변동성) 규칙 기반 점수. 기본 면책 참고.",
    }


def analyze(symbol: str, demo: bool = False) -> dict:
    sym = symbol.strip().upper()
    if not sym.replace(".", "").replace("-", "").isalnum() or len(sym) > 10:
        raise HTTPException(400, "티커 형식이 올바르지 않습니다")
    key = (sym, demo)
    if key in _cache and time.time() - _cache[key][0] < TTL:
        return _cache[key][1]
    try:
        res = analyze_series(sym, fetch_prices(sym, demo))
    except ValueError as e:  # gs_quant MqValueError도 ValueError 하위 클래스
        raise HTTPException(404, str(e))
    except Exception as e:  # 네트워크/라이브러리 오류
        raise HTTPException(502, f"시세 조회 실패: {type(e).__name__}")
    _cache[key] = (time.time(), res)
    return res


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/analyze")
def analyze_ep(symbol: str, demo: bool = False):
    return analyze(symbol, demo)


@app.get("/screen")
def screen(symbols: str = Query(..., description="쉼표 구분 티커, 최대 15개"), demo: bool = False):
    out, errors = [], {}
    for s in [x for x in symbols.split(",") if x.strip()][:15]:
        try:
            r = analyze(s, demo)
            out.append({k: r[k] for k in ("symbol", "as_of", "last", "verdict", "score", "buy_price", "target_price", "stop_price", "reward_risk")})
        except HTTPException as e:
            errors[s.strip().upper()] = e.detail
    out.sort(key=lambda x: x["score"], reverse=True)
    return {"results": out, "errors": errors, "disclaimer": DISCLAIMER}
