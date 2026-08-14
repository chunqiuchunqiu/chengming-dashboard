#!/usr/bin/env python3
"""Generate a read-only weekly A-share research report from AKShare."""

from __future__ import annotations

import json
import math
import os
import re
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from scripts.short_trend import (
        TREND_CONFIG,
        apply_market_wind,
        atr_series,
        build_observation_plan,
        calculate_structural_levels,
        classify_trend_phase,
        detect_confirmed_pivots,
        detect_current_short_trend,
        normalize_price_rows,
    )
except ImportError:  # direct `python scripts/generate_a_share_report.py`
    from short_trend import (  # type: ignore[no-redef]
        TREND_CONFIG,
        apply_market_wind,
        atr_series,
        build_observation_plan,
        calculate_structural_levels,
        classify_trend_phase,
        detect_confirmed_pivots,
        detect_current_short_trend,
        normalize_price_rows,
    )


SHANGHAI_TZ = timezone(timedelta(hours=8))


def number(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return default
        cleaned = str(value).replace(",", "").replace("%", "").strip()
        result = float(cleaned)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def rounded(value: float, digits: int = 2) -> float:
    return round(value if math.isfinite(value) else 0.0, digits)


def pick(row: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    for key, value in row.items():
        if any(name in str(key) for name in names) and value is not None:
            return value
    return default


def mean(values: Iterable[float]) -> float:
    items = list(values)
    return sum(items) / len(items) if items else 0.0


def pct_change(current: float, previous: float) -> float:
    return (current / previous - 1) * 100 if previous else 0.0


def latest_completed_period(today: date) -> str:
    if today.month <= 4:
        return f"{today.year - 1}0930"
    if today.month <= 8:
        return f"{today.year}0331"
    if today.month <= 10:
        return f"{today.year}0630"
    return f"{today.year}0930"


def period_fallbacks(today: date) -> list[str]:
    first = latest_completed_period(today)
    periods = [first]
    cursor = datetime.strptime(first, "%Y%m%d").date()
    known = [(9, 30), (6, 30), (3, 31)]
    while len(periods) < 4:
        candidates = [date(cursor.year, month, day) for month, day in known if date(cursor.year, month, day) < cursor]
        cursor = max(candidates) if candidates else date(cursor.year - 1, 9, 30)
        periods.append(cursor.strftime("%Y%m%d"))
    return periods


def iso_week(now: datetime) -> str:
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def completed_daily_cutoff(now: datetime) -> date:
    """Return the latest date on which a Shanghai daily bar may be complete.

    The 15-minute buffer avoids treating a provider's still-settling close as a
    completed bar. Weekends and exchange holidays are harmless because the
    provider simply has no row for those dates.
    """
    local = now.astimezone(SHANGHAI_TZ)
    if local.weekday() >= 5:
        return local.date()
    if (local.hour, local.minute) < (15, 15):
        return local.date() - timedelta(days=1)
    return local.date()


def technical_metrics(
    rows: list[dict[str, Any]],
    data_as_of: str | None = None,
    market_wind: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bars = normalize_price_rows(rows, data_as_of)
    short_trend = detect_current_short_trend(bars, data_as_of)
    if market_wind:
        short_trend = apply_market_wind(short_trend, market_wind)
    if len(bars) < int(TREND_CONFIG["min_history_bars"]):
        return {
            "price": rounded(bars[-1]["close"]) if bars else 0.0,
            "priceAsOf": bars[-1]["date"] if bars else None,
            "ma20": None, "ma60": None, "return20d": None, "return60d": None,
            "volumeRatio20d": None, "atr14Pct": None, "maxDrawdown60d": None,
            "support": None, "resistance": None, "buyZoneLow": None, "buyZoneHigh": None,
            "stopLoss": None, "target": None, "levelMethod": short_trend["levelMethod"],
            "observationStatus": "wait", "observationReason": "等待确认：有效交易日少于 61",
            "shortTrend": short_trend,
        }
    closes = [bar["close"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]
    last = closes[-1]
    ma20, ma60 = mean(closes[-20:]), mean(closes[-60:])
    atr14 = atr_series(bars)[-1]
    recent_volume, baseline_volume = mean(volumes[-5:]), mean(volumes[-20:])
    volume_ratio = recent_volume / baseline_volume if baseline_volume > 0 else None
    peak, max_drawdown = closes[-60], 0.0
    for close in closes[-60:]:
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, pct_change(close, peak))
    plan = build_observation_plan(last, atr14, short_trend)

    def optional_round(value: Any) -> float | None:
        return rounded(float(value)) if isinstance(value, (int, float)) and math.isfinite(float(value)) else None

    return {
        "price": rounded(last), "priceAsOf": bars[-1]["date"], "ma20": rounded(ma20), "ma60": rounded(ma60),
        "return20d": rounded(pct_change(last, closes[-21])), "return60d": rounded(pct_change(last, closes[-61])),
        "volumeRatio20d": optional_round(volume_ratio), "atr14Pct": rounded(atr14 / last * 100),
        "maxDrawdown60d": rounded(max_drawdown),
        "support": optional_round(plan["support"]), "resistance": optional_round(plan["resistance"]),
        "buyZoneLow": optional_round(plan["buyZoneLow"]), "buyZoneHigh": optional_round(plan["buyZoneHigh"]),
        "stopLoss": optional_round(plan["stopLoss"]), "target": optional_round(plan["target"]),
        "levelMethod": plan["levelMethod"], "observationStatus": plan["observationStatus"],
        "observationReason": plan["observationReason"], "shortTrend": short_trend,
    }


def score_pick(base: dict[str, Any], tech: dict[str, Any], market_wind: dict[str, Any] | None = None) -> tuple[int, dict[str, int], dict[str, int]]:
    rev, profit, roe = base["revenueGrowth"], base["profitGrowth"], base["roe"]
    fundamental = min(30, max(0, 8 + (6 if rev > 10 else 3 if rev > 0 else 0) + (8 if profit > 15 else 4 if profit > 0 else 0) + (8 if roe > 12 else 4 if roe > 6 else 0)))
    pe, pb = base["pe"], base["pb"]
    pe_score = 10 if 0 < pe <= 30 else 6 if 30 < pe <= 50 else 2 if pe > 0 else 0
    pb_score = 5 if 0 < pb <= 4 else 2 if pb > 0 else 0
    valuation = min(15, pe_score + pb_score)
    price, ma20, ma60 = number(tech.get("price")), number(tech.get("ma20")), number(tech.get("ma60"))
    return20, return60 = number(tech.get("return20d")), number(tech.get("return60d"))
    medium_trend = min(15, max(0, 3 + (4 if price > ma20 > 0 else 0) + (3 if ma20 > ma60 > 0 else 0) + (2 if return20 > 0 else 0) + (3 if return60 > 0 else 0)))
    short = tech.get("shortTrend", {})
    short_score = 0
    if short.get("direction") == "up":
        short_score += 6
    elif short.get("direction") == "range":
        short_score += 2
    if short.get("breakoutLevel") is not None:
        short_score += 4
    short_score += {"启动": 4, "回踩": 4, "延续": 3}.get(short.get("phase"), 0)
    short_score += {"strong": 3, "normal": 2}.get(short.get("volumeConfirmation"), 0)
    wind_status = (market_wind or {}).get("status", "unknown")
    if short.get("direction") == "up" and wind_status == "risk_on":
        short_score += 2
    elif short.get("direction") == "up" and wind_status == "risk_off":
        short_score -= 2
    if short.get("phase") != "过度延伸":
        short_score += 1
    short_score = min(20, max(0, short_score))
    trend = medium_trend + short_score
    atr_pct, drawdown = number(tech.get("atr14Pct")), number(tech.get("maxDrawdown60d"))
    risk = min(20, max(0, 20 - (5 if atr_pct > 4 else 2 if atr_pct > 2.5 else 0) - (6 if drawdown < -20 else 3 if drawdown < -12 else 0)))
    parts = {"fundamental": int(fundamental), "valuation": int(valuation), "trend": int(trend), "risk": int(risk)}
    detail = {"mediumTerm": int(medium_trend), "shortTerm": int(short_score)}
    return sum(parts.values()), parts, detail


def deterministic_text(item: dict[str, Any]) -> dict[str, str]:
    metrics = item["metrics"]
    return20 = number(metrics.get("return20d"))
    ma20 = number(metrics.get("ma20"))
    volume_ratio = metrics.get("volumeRatio20d")
    trend_word = "偏强" if return20 > 0 and item["price"] > ma20 > 0 else "震荡观察"
    short = item.get("shortTrend", {})
    if metrics.get("fundamentalCoverage"):
        fundamentals = f"营收同比 {metrics['revenueGrowth']:.1f}%，净利润同比 {metrics['profitGrowth']:.1f}%，ROE {metrics['roe']:.1f}%；PE {metrics['pe']:.1f} 倍，PB {metrics['pb']:.1f} 倍。"
    else:
        fundamentals = "本次免费财务接口未返回可验证字段，基本面已降权；请在公司定期报告中复核营收、利润、ROE 与现金流。"
    return {
        "reason": f"综合评分 {item['score']}，基本面、估值与量价趋势处于候选池前列。",
        "fundamentals": fundamentals,
        "sentiment": f"量价情绪代理为{trend_word}：20日涨跌 {return20:.1f}%，近5日/20日均量比 {volume_ratio:.2f}。未接入新闻或社交情绪。" if volume_ratio is not None else f"量价情绪代理为{trend_word}：20日涨跌 {return20:.1f}%，成交量数据不足。未接入新闻或社交情绪。",
        "trend": f"本轮短期方向 {short.get('direction', 'insufficient_data')}，阶段 {short.get('phase', '数据不足')}；启动点、结构价位和失效位均由已确认 Pivot 与 BOS 确定，不由摘要模型生成。",
        "risk": f"60日最大回撤 {number(metrics.get('maxDrawdown60d')):.1f}%；结构失效位与 ATR 目标只用于研究观察，不是交易指令。",
        "invalidates": "跌破风险参考位、业绩增速转负或关键财务数据明显恶化",
    }


def fetch_with_retry(fn: Any, *args: Any, attempts: int = 3, **kwargs: Any) -> Any:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # network/provider failures are retried
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"数据源连续失败：{last}") from last


def financial_rows(ak: Any, today: date) -> tuple[dict[str, dict[str, Any]], str]:
    for period in period_fallbacks(today):
        try:
            frame = fetch_with_retry(ak.stock_yjbb_em, date=period, attempts=2)
            if frame is not None and not frame.empty:
                result = {}
                for raw in frame.to_dict("records"):
                    code = normalize_code(pick(raw, "股票代码", "代码", default=""))
                    if code:
                        result[code] = raw
                return result, period
        except Exception:
            continue
    return {}, "unavailable"


def normalize_code(value: Any) -> str:
    match = re.search(r"(\d{6})$", str(value).strip())
    return match.group(1) if match else ""


def spot_market(ak: Any, attempts: int = 3) -> tuple[Any, str]:
    try:
        return fetch_with_retry(ak.stock_zh_a_spot_em, attempts=attempts), "东方财富全市场行情"
    except Exception:
        print("primary spot provider unavailable; switching to Sina fallback")
        return fetch_with_retry(ak.stock_zh_a_spot, attempts=attempts), "新浪财经全市场行情（备用）"


def history_frame(ak: Any, code: str, start: str, end: str, attempts: int = 1, prefer_sina: bool = False) -> tuple[Any, str]:
    if not prefer_sina:
        try:
            frame = fetch_with_retry(ak.stock_zh_a_hist, symbol=code, period="daily", start_date=start, end_date=end, adjust="qfq", attempts=attempts)
            return frame, "东方财富历史行情"
        except Exception:
            pass
    symbol = f"sh{code}" if code.startswith("6") else f"sz{code}"
    frame = fetch_with_retry(ak.stock_zh_a_daily, symbol=symbol, start_date=start, end_date=end, adjust="qfq", attempts=attempts)
    return frame, "新浪财经历史行情（备用）"


INDEX_SYMBOLS = (
    ("上证指数", "sh000001"),
    ("沪深300", "sh000300"),
    ("创业板指", "sz399006"),
)


def index_history_frame(ak: Any, symbol: str, start: str, end: str) -> Any:
    """Pinned AKShare 1.18.64 signature verified against official docs."""
    return fetch_with_retry(ak.stock_zh_index_daily_tx, symbol=symbol, start_date=start, end_date=end, attempts=1)


def index_metrics(name: str, symbol: str, rows: list[dict[str, Any]], data_as_of: str | None = None) -> dict[str, Any]:
    bars = normalize_price_rows(rows, data_as_of)
    if len(bars) < 21:
        raise ValueError("指数有效行情少于 21 个交易日")
    closes = [bar["close"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]

    def ema(values: list[float], period: int) -> float:
        alpha, current = 2.0 / (period + 1), values[0]
        for value in values[1:]:
            current = alpha * value + (1 - alpha) * current
        return current

    ema5, ema10, ema20 = ema(closes, 5), ema(closes, 10), ema(closes, 20)
    volume_base = mean(volumes[-20:])
    ratio = mean(volumes[-5:]) / volume_base if volume_base > 0 else None
    checks = [closes[-1] > ema20, ema5 > ema10, pct_change(closes[-1], closes[-6]) > 0, pct_change(closes[-1], closes[-11]) > 0, pct_change(closes[-1], closes[-21]) > 0]
    return {
        "name": name, "symbol": symbol, "asOf": bars[-1]["date"], "close": rounded(closes[-1]),
        "return5d": rounded(pct_change(closes[-1], closes[-6])), "return10d": rounded(pct_change(closes[-1], closes[-11])),
        "return20d": rounded(pct_change(closes[-1], closes[-21])), "ema5": rounded(ema5), "ema10": rounded(ema10), "ema20": rounded(ema20),
        "aboveEma20": closes[-1] > ema20, "ema5AboveEma10": ema5 > ema10,
        "volumeRatio20d": rounded(ratio) if ratio is not None else None, "score": sum(checks), "status": "ok",
    }


def load_market_wind(ak: Any, start: str, end: str, data_as_of: str | None = None) -> dict[str, Any]:
    indices: list[dict[str, Any]] = []
    for name, symbol in INDEX_SYMBOLS:
        try:
            frame = index_history_frame(ak, symbol, start, end)
            indices.append(index_metrics(name, symbol, frame.to_dict("records"), data_as_of))
        except Exception:
            indices.append({"name": name, "symbol": symbol, "asOf": None, "status": "unknown"})
    valid = [item for item in indices if item.get("status") == "ok"]
    if len(valid) < 2:
        return {"status": "unknown", "score": None, "asOf": None, "indices": indices}
    score = round(sum(item["score"] for item in valid) / (len(valid) * 5) * 100)
    status = "risk_on" if score >= 67 else "risk_off" if score <= 33 else "neutral"
    return {"status": status, "score": score, "asOf": min(item["asOf"] for item in valid), "indices": indices}


def build_base(spot_row: dict[str, Any], fin_row: dict[str, Any]) -> dict[str, Any] | None:
    code = normalize_code(pick(spot_row, "代码", default=""))
    name = str(pick(spot_row, "名称", default="")).strip()
    if not re.fullmatch(r"[036]\d{5}", code) or any(flag in name.upper() for flag in ("ST", "退")):
        return None
    price = number(pick(spot_row, "最新价"))
    pe = number(pick(spot_row, "市盈率-动态", "市盈率"))
    pb = number(pick(spot_row, "市净率"))
    eps = number(pick(fin_row, "每股收益"))
    book_value = number(pick(fin_row, "每股净资产"))
    if pe <= 0 and eps > 0:
        pe = price / eps
    if pb <= 0 and book_value > 0:
        pb = price / book_value
    amount = number(pick(spot_row, "成交额"))
    market_cap = number(pick(spot_row, "总市值")) / 100_000_000
    turnover = number(pick(spot_row, "换手率"))
    if price <= 0 or amount < 50_000_000 or (market_cap > 0 and market_cap < 50) or pe > 80 or pb > 12:
        return None
    industry = str(pick(fin_row, "所处行业", "行业", default="未分类"))[:30]
    return {
        "code": code, "name": name[:30], "industry": industry,
        "price": rounded(price), "pe": rounded(pe), "pb": rounded(pb),
        "marketCapYi": rounded(market_cap), "turnoverRate": rounded(turnover),
        "revenueGrowth": rounded(number(pick(fin_row, "营业收入-同比增长", "营业收入同比增长", "营收同比"))),
        "profitGrowth": rounded(number(pick(fin_row, "净利润-同比增长", "净利润同比增长"))),
        "roe": rounded(number(pick(fin_row, "净资产收益率"))),
        "operatingCashFlowPerShare": rounded(number(pick(fin_row, "每股经营现金流量", "每股经营现金流"))),
        "grossMargin": rounded(number(pick(fin_row, "销售毛利率", "毛利率"))),
        "fundamentalCoverage": bool(fin_row),
        "amount": amount,
    }


def prefilter_score(item: dict[str, Any]) -> float:
    valuation_penalty = (item["pe"] * 0.08 if item["pe"] > 0 else 0) + (item["pb"] * 0.25 if item["pb"] > 0 else 0)
    return item["revenueGrowth"] * 0.15 + item["profitGrowth"] * 0.2 + item["roe"] * 0.35 - valuation_penalty + math.log10(max(item["amount"], 1))


def load_market(ak: Any | None = None) -> tuple[list[dict[str, Any]], str, str, str]:
    if ak is None:
        import akshare as ak_module  # lazy import keeps pure unit tests dependency-free
        ak = ak_module

    now = datetime.now(SHANGHAI_TZ)
    today = now.date()
    data_as_of = completed_daily_cutoff(now).isoformat()
    spot, spot_provider = spot_market(ak)
    if "备用" in spot_provider:
        finances, period = {}, "unavailable"
        print("financial endpoint skipped because the primary provider is unavailable")
    else:
        finances, period = financial_rows(ak, today)
    bases = []
    for row in spot.to_dict("records"):
        code = normalize_code(pick(row, "代码", default=""))
        base = build_base(row, finances.get(code, {}))
        if base:
            bases.append(base)
    bases.sort(key=prefilter_score, reverse=True)
    return bases[:40], period, data_as_of, spot_provider


def generate_report(ak: Any | None = None) -> dict[str, Any]:
    if ak is None:
        import akshare as ak_module
        ak = ak_module

    bases, finance_period, data_as_of, spot_provider = load_market(ak)
    evaluated = []
    end = datetime.now(SHANGHAI_TZ).strftime("%Y%m%d")
    start = (datetime.now(SHANGHAI_TZ) - timedelta(days=220)).strftime("%Y%m%d")
    market_wind = load_market_wind(ak, start, end, data_as_of)
    for base in bases:
        try:
            frame, _history_provider = history_frame(
                ak,
                base["code"],
                start,
                end,
                prefer_sina="备用" in spot_provider,
            )
            tech = technical_metrics(frame.to_dict("records"), data_as_of, market_wind)
            score, parts, trend_detail = score_pick(base, tech, market_wind)
            metrics = {key: value for key, value in base.items() if key not in {"code", "name", "industry", "price", "amount"}}
            metrics.update({key: value for key, value in tech.items() if key not in {"price", "priceAsOf", "support", "resistance", "buyZoneLow", "buyZoneHigh", "stopLoss", "target", "shortTrend", "levelMethod", "observationStatus", "observationReason"}})
            item = {"code": base["code"], "name": base["name"], "industry": base["industry"], "price": tech["price"], "priceAsOf": tech["priceAsOf"], "score": score, "scoreBreakdown": parts, "metrics": metrics,
                    "trendDetail": trend_detail, "shortTrend": tech["shortTrend"],
                    "support": tech["support"], "resistance": tech["resistance"], "buyZoneLow": tech["buyZoneLow"], "buyZoneHigh": tech["buyZoneHigh"],
                    "stopLoss": tech["stopLoss"], "target": tech["target"], "levelMethod": tech["levelMethod"],
                    "observationStatus": tech["observationStatus"], "observationReason": tech["observationReason"]}
            item.update(deterministic_text(item))
            evaluated.append(item)
        except Exception as exc:
            print(f"skip {base['code']}: {type(exc).__name__}")
            continue
    evaluated.sort(key=lambda item: item["score"], reverse=True)
    selected, sectors = [], Counter()
    for item in evaluated:
        if sectors[item["industry"]] >= 2:
            continue
        selected.append(item)
        sectors[item["industry"]] += 1
        if len(selected) == 10:
            break
    if len(selected) < 10:
        for item in evaluated:
            if item not in selected:
                selected.append(item)
            if len(selected) == 10:
                break
    if not selected:
        raise RuntimeError("未能获得满足质量门槛的股票数据")
    for rank, item in enumerate(selected, 1):
        item["rank"] = rank
    now = datetime.now(SHANGHAI_TZ)
    report = {
        "schemaVersion": 2, "isoYearWeek": iso_week(now), "market": "A股", "status": "success" if len(selected) == 10 and finance_period != "unavailable" else "partial",
        "dataAsOf": data_as_of, "generatedAt": now.isoformat(), "dataProvider": f"AKShare（{spot_provider}；财报期 {finance_period}）",
        "summaryProvider": "规则引擎", "methodology": "先按流动性、规模、估值和财务质量筛选；中期趋势使用 MA20/MA60 与 20/60 日表现，本轮短期趋势仅使用已确认 Swing Pivot、结构突破、回踩、量能和 A 股指数风向。结构价位与 ATR 目标参考严格分离；最多保留同一行业 2 只。",
        "sentimentDefinition": "情绪面仅使用涨跌幅与成交量构成的量价代理，不包含新闻、社交媒体或主观市场传闻。",
        "disclaimer": "仅供研究观察，不构成个性化投资建议或收益承诺；关键价位是历史统计参考，不是交易指令。系统没有下单、撤单或账户操作权限。",
        "marketWind": market_wind, "stocks": selected,
    }
    enrich_with_deepseek(report)
    return report


def enrich_with_deepseek(report: dict[str, Any]) -> None:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return
    import requests

    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    compact = [{"code": item["code"], "name": item["name"], "industry": item["industry"], "price": item["price"], "score": item["score"], "metrics": item["metrics"], "shortTrend": item["shortTrend"], "marketWind": report.get("marketWind")} for item in report["stocks"]]
    prompt = """你是严谨的A股研究编辑。你只能解释输入中已经由确定性规则计算的数字、shortTrend 与 marketWind，不得重新判断趋势方向、寻找启动点、计算支撑/压力/观察区间/评分，不得修改任何数值，不得添加新闻、政策、公告、机构观点或未提供事实，不得使用保证收益措辞。返回严格JSON：{\"items\":[{\"code\":\"6位代码\",\"reason\":\"不超过80字\",\"fundamentals\":\"不超过120字\",\"sentiment\":\"明确写量价情绪代理，不超过100字\",\"risk\":\"不超过100字\",\"invalidates\":\"不超过80字\"}]}。"""
    try:
        response = requests.post(f"{base_url}/chat/completions", headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"}, json={"model": model, "temperature": 0.1, "response_format": {"type": "json_object"}, "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": json.dumps(compact, ensure_ascii=False)}]}, timeout=(10, 90))
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
        items = json.loads(content).get("items", [])
        by_code = {str(item.get("code")): item for item in items if isinstance(item, dict)}
        for target in report["stocks"]:
            source = by_code.get(target["code"], {})
            for key, limit in (("reason", 160), ("fundamentals", 240), ("sentiment", 200), ("risk", 200), ("invalidates", 160)):
                value = source.get(key)
                if isinstance(value, str) and value.strip():
                    target[key] = value.strip()[:limit]
        report["summaryProvider"] = f"DeepSeek {model}（仅摘要）"
    except Exception as exc:
        report["summaryProvider"] = f"规则引擎（DeepSeek不可用：{type(exc).__name__}）"


def publish(report: dict[str, Any]) -> None:
    import requests

    output = Path(os.getenv("REPORT_OUTPUT", "outputs/a-share-report.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    url = os.getenv("DASHBOARD_INGEST_URL", "").strip()
    secret = os.getenv("REPORT_INGEST_SECRET", "").strip()
    if not url or not secret:
        raise RuntimeError("缺少 DASHBOARD_INGEST_URL 或 REPORT_INGEST_SECRET")
    headers = {"authorization": f"Bearer {secret}", "content-type": "application/json"}
    sites_token = os.getenv("SITES_BYPASS_TOKEN", "").strip()
    if sites_token:
        headers["OAI-Sites-Authorization"] = f"Bearer {sites_token}"
    response = requests.post(url, headers=headers, json=report, timeout=(10, 60))
    response.raise_for_status()
    print(f"stored {report['isoYearWeek']} with {len(report['stocks'])} picks")


def main() -> None:
    publish(generate_report())


if __name__ == "__main__":
    main()
