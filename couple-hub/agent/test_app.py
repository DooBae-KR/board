# 실행: python test_app.py  (네트워크 불필요, 합성 데이터)
import subprocess, sys
import numpy as np, pandas as pd
from app import analyze_series, fetch_prices, screen, _clean
from gs_quant.timeseries import bollinger_bands, volatility, moving_average, relative_strength_index

def test_analysis_shape_and_ordering():
    r = analyze_series("TEST", fetch_prices("TEST", demo=True))
    assert r["stop_price"] < r["buy_price"] <= r["last"] * 1.0001
    assert r["target_price"] > r["buy_price"]
    assert r["verdict"] in ("매수 우위", "관망/중립", "주의(하락 우위)")
    assert len(r["series"]["dates"]) == len(r["series"]["close"]) == 120
    assert "투자 권유가 아닙니다" in r["disclaimer"]

def test_screen_sorted_and_bad_ticker():
    s = screen("AAA,BBB,CCC,@@", demo=True)
    sc = [x["score"] for x in s["results"]]
    assert sc == sorted(sc, reverse=True) and len(sc) == 3 and "@@" in s["errors"]

def test_bollinger_centered_on_ma20():
    r = analyze_series("TEST", fetch_prices("TEST", demo=True))
    i = r["indicators"]
    assert abs((i["bb_low"] + i["bb_high"]) / 2 - i["ma20"]) < 0.02 * i["ma20"]
    assert 5 < i["vol_annual_pct"] < 80

IDX = pd.bdate_range(end="2026-10-01", periods=320)

def test_demo_seed_stable_across_processes():
    code = "from app import fetch_prices;print(repr(float(fetch_prices('AAPL',demo=True).iloc[:3].sum())))"
    outs = {subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                           env={**__import__('os').environ, "PYTHONHASHSEED": h}).stdout for h in ("1", "2", "3")}
    assert len(outs) == 1

def test_flat_series_no_zero_division():
    r = analyze_series("FLAT", pd.Series(100.0, index=IDX))
    assert r["buy_price"] == r["stop_price"] == 100.0 and r["reward_risk"] is None
    assert r["indicators"]["vol_annual_pct"] == 0 and not any("RSI" in x for x in r["reasons"])

def test_short_history_raises_valueerror():
    for n in (1, 30, 150):
        try:
            analyze_series("S", pd.Series(np.linspace(100, 110, n), index=IDX[:n]))
        except ValueError:
            continue
        raise AssertionError("짧은 이력은 ValueError여야 함")

def test_nan_and_nonpositive_values_cleaned():
    v = 100 + np.arange(320) * 0.1
    v[[5, 100, 319]] = np.nan; v[200] = -1; v[250] = np.inf
    r = analyze_series("N", pd.Series(v, index=IDX))
    assert r["last"] is not None and r["stop_price"] is not None
    bad = pd.Series(np.nan, index=IDX)
    try:
        analyze_series("N", bad)
    except ValueError:
        pass
    else:
        raise AssertionError

def test_tz_aware_and_naive_index():
    v = pd.Series(100 * np.exp(np.cumsum(np.random.default_rng(1).normal(0, .01, 320))), index=IDX)
    naive = analyze_series("T", v)
    aware = analyze_series("T", v.set_axis(IDX.tz_localize("America/New_York")))
    assert naive["as_of"] == aware["as_of"] and naive["last"] == aware["last"]
    assert _clean("T", v.set_axis(IDX.tz_localize("America/New_York") + pd.Timedelta(hours=16))).index.tz is None

def test_gs_quant_windows():
    c = fetch_prices("W", demo=True)
    i = analyze_series("W", c)["indicators"]
    lo, hi = bollinger_bands(c, 20).iloc[-1, 0], bollinger_bands(c, 20).iloc[-1, 1]
    assert abs(i["bb_low"] - lo) < .01 and abs(i["bb_high"] - hi) < .01
    assert abs(i["vol_annual_pct"] - float(volatility(c, 21).iloc[-1])) < .01
    assert abs(i["rsi14"] - float(relative_strength_index(c, 14).iloc[-1])) < .01
    assert abs(i["ma200"] - float(moving_average(c, 200).iloc[-1])) < .01
    # 창이 21일이면 전체 기간 변동성과 달라야 한다(창 지정 회귀 방지)
    assert abs(float(volatility(c).iloc[-1]) - i["vol_annual_pct"]) > 1e-6

if __name__ == "__main__":
    test_analysis_shape_and_ordering(); test_screen_sorted_and_bad_ticker(); test_bollinger_centered_on_ma20()
    for f in (test_demo_seed_stable_across_processes, test_flat_series_no_zero_division, test_short_history_raises_valueerror,
              test_nan_and_nonpositive_values_cleaned, test_tz_aware_and_naive_index, test_gs_quant_windows): f()
    print("OK 9 tests")
