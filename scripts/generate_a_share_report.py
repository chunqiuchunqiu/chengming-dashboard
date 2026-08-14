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


def technical_metrics(rows: list[dict[str, Any]]) -> dict[str, float]:
    closes = [number(pick(row, "收盘", "close")) for row in rows]
    highs = [number(pick(row, "最高", "high")) for row in rows]
    lows = [number(pick(row, "最低", "low")) for row in rows]
    volumes = [number(pick(row, "成交量", "volume")) for row in rows]
    valid = [(c, h, l, v) for c, h, l, v in zip(closes, highs, lows, volumes) if c > 0 and h > 0 and l > 0]
    if len(valid) < 61:
        raise ValueError("有效历史行情少于 61 个交易日")
    closes, highs, lows, volumes = map(list, zip(*valid))
    last = closes[-1]
    ma20, ma60 = mean(closes[-20:]), mean(closes[-60:])
    true_ranges = []
    for i in range(1, len(closes)):
        true_ranges.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    atr14 = mean(true_ranges[-14:])
    volume_ratio = mean(volumes[-5:]) / mean(volumes[-20:]) if mean(volumes[-20:]) else 0.0
    peak, max_drawdown = closes[-60], 0.0
    for close in closes[-60:]:
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, pct_change(close, peak))
    support = min(lows[-20:])
    resistance = max(highs[-60:])
    buy_low = max(support, ma20 - atr14 * 0.5)
    buy_high = max(buy_low, ma20 + atr14 * 0.35)
    stop = max(0.01, support - atr14 * 0.7)
    target = max(resistance, last + atr14 * 2.0)
    return {
        "price": rounded(last), "ma20": rounded(ma20), "ma60": rounded(ma60),
        "return20d": rounded(pct_change(last, closes[-21])), "return60d": rounded(pct_change(last, closes[-61])),
        "volumeRatio20d": rounded(volume_ratio), "atr14Pct": rounded(atr14 / last * 100),
        "maxDrawdown60d": rounded(max_drawdown), "support": rounded(support), "resistance": rounded(resistance),
        "buyZoneLow": rounded(buy_low), "buyZoneHigh": rounded(buy_high), "stopLoss": rounded(stop), "target": rounded(target),
    }


def score_pick(base: dict[str, Any], tech: dict[str, float]) -> tuple[int, dict[str, int]]:
    rev, profit, roe = base["revenueGrowth"], base["profitGrowth"], base["roe"]
    fundamental = min(30, max(0, 8 + (6 if rev > 10 else 3 if rev > 0 else 0) + (8 if profit > 15 else 4 if profit > 0 else 0) + (8 if roe > 12 else 4 if roe > 6 else 0)))
    pe, pb = base["pe"], base["pb"]
    valuation = min(15, max(0, (10 if 0 < pe <= 30 else 6 if pe <= 50 else 2) + (5 if 0 < pb <= 4 else 2)))
    trend = min(35, max(0, 12 + (8 if tech["price"] > tech["ma20"] else 0) + (7 if tech["ma20"] > tech["ma60"] else 0) + (5 if tech["return20d"] > 0 else 0) + (3 if tech["volumeRatio20d"] >= 1 else 0)))
    risk = min(20, max(0, 20 - (5 if tech["atr14Pct"] > 4 else 2 if tech["atr14Pct"] > 2.5 else 0) - (6 if tech["maxDrawdown60d"] < -20 else 3 if tech["maxDrawdown60d"] < -12 else 0)))
    parts = {"fundamental": int(fundamental), "valuation": int(valuation), "trend": int(trend), "risk": int(risk)}
    return sum(parts.values()), parts


def deterministic_text(item: dict[str, Any]) -> dict[str, str]:
    metrics = item["metrics"]
    trend_word = "偏强" if metrics["return20d"] > 0 and item["price"] > metrics["ma20"] else "震荡观察"
    return {
        "reason": f"综合评分 {item['score']}，基本面、估值与量价趋势处于候选池前列。",
        "fundamentals": f"营收同比 {metrics['revenueGrowth']:.1f}%，净利润同比 {metrics['profitGrowth']:.1f}%，ROE {metrics['roe']:.1f}%；PE {metrics['pe']:.1f} 倍，PB {metrics['pb']:.1f} 倍。",
        "sentiment": f"量价情绪代理为{trend_word}：20日涨跌 {metrics['return20d']:.1f}%，近5日/20日均量比 {metrics['volumeRatio20d']:.2f}。未接入新闻或社交情绪。",
        "trend": f"现价 {item['price']:.2f}，MA20 {metrics['ma20']:.2f}，MA60 {metrics['ma60']:.2f}，ATR14/价格 {metrics['atr14Pct']:.1f}%。",
        "risk": f"60日最大回撤 {metrics['maxDrawdown60d']:.1f}%；止损位仅为波动管理参考，不是交易指令。",
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
                    code = str(pick(raw, "股票代码", "代码", default="")).zfill(6)
                    if code:
                        result[code] = raw
                return result, period
        except Exception:
            continue
    return {}, "unavailable"


def build_base(spot_row: dict[str, Any], fin_row: dict[str, Any]) -> dict[str, Any] | None:
    code = str(pick(spot_row, "代码", default="")).zfill(6)
    name = str(pick(spot_row, "名称", default="")).strip()
    if not re.fullmatch(r"[036]\d{5}", code) or any(flag in name.upper() for flag in ("ST", "退")):
        return None
    price = number(pick(spot_row, "最新价"))
    pe = number(pick(spot_row, "市盈率-动态", "市盈率"), 999)
    pb = number(pick(spot_row, "市净率"), 999)
    amount = number(pick(spot_row, "成交额"))
    market_cap = number(pick(spot_row, "总市值")) / 100_000_000
    turnover = number(pick(spot_row, "换手率"))
    if price <= 0 or amount < 50_000_000 or market_cap < 50 or pe <= 0 or pe > 80 or pb <= 0 or pb > 12:
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
        "amount": amount,
    }


def prefilter_score(item: dict[str, Any]) -> float:
    return item["revenueGrowth"] * 0.15 + item["profitGrowth"] * 0.2 + item["roe"] * 0.35 - item["pe"] * 0.08 - item["pb"] * 0.25 + math.log10(max(item["amount"], 1))


def load_market() -> tuple[list[dict[str, Any]], str, str]:
    import akshare as ak  # lazy import keeps pure unit tests dependency-free

    today = datetime.now(SHANGHAI_TZ).date()
    spot = fetch_with_retry(ak.stock_zh_a_spot_em)
    finances, period = financial_rows(ak, today)
    bases = []
    for row in spot.to_dict("records"):
        base = build_base(row, finances.get(str(pick(row, "代码", default="")).zfill(6), {}))
        if base:
            bases.append(base)
    bases.sort(key=prefilter_score, reverse=True)
    return bases[:40], period, today.isoformat()


def generate_report() -> dict[str, Any]:
    import akshare as ak

    bases, finance_period, data_as_of = load_market()
    evaluated = []
    end = datetime.now(SHANGHAI_TZ).strftime("%Y%m%d")
    start = (datetime.now(SHANGHAI_TZ) - timedelta(days=220)).strftime("%Y%m%d")
    for base in bases:
        try:
            frame = fetch_with_retry(ak.stock_zh_a_hist, symbol=base["code"], period="daily", start_date=start, end_date=end, adjust="qfq", attempts=2)
            tech = technical_metrics(frame.to_dict("records"))
            score, parts = score_pick(base, tech)
            metrics = {key: value for key, value in base.items() if key not in {"code", "name", "industry", "price", "amount"}}
            metrics.update({key: value for key, value in tech.items() if key not in {"price", "support", "resistance", "buyZoneLow", "buyZoneHigh", "stopLoss", "target"}})
            item = {"code": base["code"], "name": base["name"], "industry": base["industry"], "price": tech["price"], "score": score, "scoreBreakdown": parts, "metrics": metrics,
                    "support": tech["support"], "resistance": tech["resistance"], "buyZoneLow": tech["buyZoneLow"], "buyZoneHigh": tech["buyZoneHigh"], "stopLoss": tech["stopLoss"], "target": tech["target"]}
            item.update(deterministic_text(item))
            evaluated.append(item)
        except Exception:
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
        "schemaVersion": 1, "isoYearWeek": iso_week(now), "market": "A股", "status": "success" if len(selected) == 10 else "partial",
        "dataAsOf": data_as_of, "generatedAt": now.isoformat(), "dataProvider": f"AKShare（东方财富公开数据接口；财报期 {finance_period}）",
        "summaryProvider": "规则引擎", "methodology": "先按流动性、规模、估值和财务质量筛选，再对候选计算均线、量能、ATR、回撤及关键价位；最多保留同一行业 2 只。",
        "sentimentDefinition": "情绪面仅使用涨跌幅与成交量构成的量价代理，不包含新闻、社交媒体或主观市场传闻。",
        "disclaimer": "仅供研究观察，不构成个性化投资建议或收益承诺；关键价位是历史统计参考，不是交易指令。系统没有下单、撤单或账户操作权限。",
        "stocks": selected,
    }
    enrich_with_deepseek(report)
    return report


def enrich_with_deepseek(report: dict[str, Any]) -> None:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return
    import requests

    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    compact = [{"code": item["code"], "name": item["name"], "industry": item["industry"], "price": item["price"], "score": item["score"], "metrics": item["metrics"]} for item in report["stocks"]]
    prompt = """你是严谨的A股研究编辑。只根据输入数字润色摘要，不得添加新闻、政策、公告、机构观点或未提供事实，不得修改任何数值，不得使用保证收益措辞。返回严格JSON：{\"items\":[{\"code\":\"6位代码\",\"reason\":\"不超过80字\",\"fundamentals\":\"不超过120字\",\"sentiment\":\"明确写量价情绪代理，不超过100字\",\"risk\":\"不超过100字\",\"invalidates\":\"不超过80字\"}]}。"""
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
