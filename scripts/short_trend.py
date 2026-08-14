"""Deterministic, read-only A-share short-trend structure analysis.

The module contains no network, account, order or secret access.  Every pivot is
only usable after its right-hand confirmation bars have completed, which keeps
the result free of look-ahead bias.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any, Iterable


# All tunable thresholds live here so reports and tests use the same rules.
TREND_CONFIG: dict[str, float | int] = {
    "min_history_bars": 61,
    "left_bars": 3,
    "right_bars": 3,
    "atr_period": 14,
    "min_swing_pct": 0.012,
    "min_swing_atr": 0.75,
    "breakout_buffer_pct": 0.003,
    "startup_max_age_bars": 5,
    "startup_max_distance_atr": 1.0,
    "pullback_distance_atr": 1.0,
    "extension_distance_atr": 2.5,
    "volume_strong_ratio": 1.5,
    "volume_normal_ratio": 1.2,
    "observation_band_atr": 0.35,
    "stop_buffer_atr": 0.5,
    "atr_target_multiple": 2.0,
    "min_reward_risk": 2.0,
}


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None:
            return default
        cleaned = str(value).replace(",", "").replace("%", "").strip()
        if not cleaned:
            return default
        result = float(cleaned)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _pick(row: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return default


def _iso_day(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()[:10].replace("/", "-")
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def normalize_price_rows(rows: Iterable[dict[str, Any]], data_as_of: str | None = None) -> list[dict[str, Any]]:
    """Sort, validate and deterministically de-duplicate completed daily bars."""
    cutoff = _iso_day(data_as_of) if data_as_of else None
    by_day: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = _iso_day(_pick(row, "日期", "date", "trade_date"))
        close = _number(_pick(row, "收盘", "close"))
        high = _number(_pick(row, "最高", "high"))
        low = _number(_pick(row, "最低", "low"))
        volume = _number(_pick(row, "成交量", "volume", "amount"), 0.0)
        if not day or (cutoff and day > cutoff) or close is None or high is None or low is None:
            continue
        if close <= 0 or high <= 0 or low <= 0 or high < low or not (low <= close <= high):
            continue
        candidate = {"date": day, "close": close, "high": high, "low": low, "volume": max(0.0, volume or 0.0)}
        previous = by_day.get(day)
        # Provider duplicates are resolved without relying on input order.
        if previous is None or (candidate["volume"], candidate["close"], candidate["high"], -candidate["low"]) > (
            previous["volume"], previous["close"], previous["high"], -previous["low"]
        ):
            by_day[day] = candidate
    return [by_day[key] for key in sorted(by_day)]


def ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2.0 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def atr_series(bars: list[dict[str, Any]], period: int | None = None) -> list[float]:
    period = int(period or TREND_CONFIG["atr_period"])
    ranges: list[float] = []
    result: list[float] = []
    for index, bar in enumerate(bars):
        previous_close = bars[index - 1]["close"] if index else bar["close"]
        true_range = max(bar["high"] - bar["low"], abs(bar["high"] - previous_close), abs(bar["low"] - previous_close))
        ranges.append(true_range)
        result.append(sum(ranges[max(0, len(ranges) - period):]) / min(period, len(ranges)))
    return result


def detect_confirmed_pivots(
    bars: list[dict[str, Any]],
    *,
    left_bars: int | None = None,
    right_bars: int | None = None,
    min_swing_pct: float | None = None,
    min_swing_atr: float | None = None,
) -> list[dict[str, Any]]:
    """Return alternating pivots; each carries the bar on which it became known."""
    left = int(left_bars if left_bars is not None else TREND_CONFIG["left_bars"])
    right = int(right_bars if right_bars is not None else TREND_CONFIG["right_bars"])
    min_pct = float(min_swing_pct if min_swing_pct is not None else TREND_CONFIG["min_swing_pct"])
    min_atr = float(min_swing_atr if min_swing_atr is not None else TREND_CONFIG["min_swing_atr"])
    if left < 1 or right < 1:
        raise ValueError("left_bars and right_bars must be positive")
    atrs = atr_series(bars)
    candidates: list[dict[str, Any]] = []
    for index in range(left, len(bars) - right):
        bar = bars[index]
        left_slice, right_slice = bars[index - left:index], bars[index + 1:index + right + 1]
        is_high = bar["high"] > max(item["high"] for item in left_slice) and bar["high"] >= max(item["high"] for item in right_slice)
        is_low = bar["low"] < min(item["low"] for item in left_slice) and bar["low"] <= min(item["low"] for item in right_slice)
        if is_high:
            candidates.append({"type": "high", "index": index, "date": bar["date"], "price": bar["high"], "confirmationIndex": index + right, "confirmationDate": bars[index + right]["date"], "confirmationLagBars": right})
        if is_low:
            candidates.append({"type": "low", "index": index, "date": bar["date"], "price": bar["low"], "confirmationIndex": index + right, "confirmationDate": bars[index + right]["date"], "confirmationLagBars": right})
    candidates.sort(key=lambda item: (item["index"], 0 if item["type"] == "low" else 1))

    pivots: list[dict[str, Any]] = []
    for candidate in candidates:
        if pivots and candidate["type"] == pivots[-1]["type"]:
            more_extreme = candidate["price"] > pivots[-1]["price"] if candidate["type"] == "high" else candidate["price"] < pivots[-1]["price"]
            if more_extreme:
                pivots[-1] = candidate
            continue
        if pivots:
            anchor = pivots[-1]
            threshold = max(abs(anchor["price"]) * min_pct, atrs[candidate["index"]] * min_atr)
            if abs(candidate["price"] - anchor["price"]) < threshold:
                continue
        pivots.append(candidate)
    return pivots


def _volume_confirmation(bars: list[dict[str, Any]], breakout_index: int) -> str:
    if breakout_index < 20:
        return "unknown"
    baseline = [item["volume"] for item in bars[breakout_index - 20:breakout_index] if item["volume"] > 0]
    current = bars[breakout_index]["volume"]
    if not baseline or current <= 0:
        return "unknown"
    ratio = current / (sum(baseline) / len(baseline))
    if ratio >= float(TREND_CONFIG["volume_strong_ratio"]):
        return "strong"
    if ratio >= float(TREND_CONFIG["volume_normal_ratio"]):
        return "normal"
    return "weak"


def _breakout_events(bars: list[dict[str, Any]], pivots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buffer_pct = float(TREND_CONFIG["breakout_buffer_pct"])
    events: list[dict[str, Any]] = []
    for first, second in zip(pivots, pivots[1:]):
        start_at = max(first["confirmationIndex"], second["confirmationIndex"], second["index"] + 1)
        if first["type"] == "high" and second["type"] == "low":
            found = next((i for i in range(start_at, len(bars)) if bars[i]["close"] > first["price"] * (1 + buffer_pct)), None)
            if found is not None:
                events.append({"direction": "up", "breakoutIndex": found, "breakoutDate": bars[found]["date"], "breakoutLevel": first["price"], "startPivot": second, "volumeConfirmation": _volume_confirmation(bars, found)})
        elif first["type"] == "low" and second["type"] == "high":
            found = next((i for i in range(start_at, len(bars)) if bars[i]["close"] < first["price"] * (1 - buffer_pct)), None)
            if found is not None:
                events.append({"direction": "down", "breakoutIndex": found, "breakoutDate": bars[found]["date"], "breakoutLevel": first["price"], "startPivot": second, "volumeConfirmation": _volume_confirmation(bars, found)})
    return sorted(events, key=lambda item: (item["breakoutIndex"], item["direction"]))


def calculate_structural_levels(
    bars: list[dict[str, Any]], pivots: list[dict[str, Any]], event: dict[str, Any] | None
) -> dict[str, Any]:
    price = bars[-1]["close"] if bars else None
    confirmed = [pivot for pivot in pivots if pivot["confirmationIndex"] < len(bars)]
    highs = [pivot for pivot in confirmed if pivot["type"] == "high"]
    lows = [pivot for pivot in confirmed if pivot["type"] == "low"]
    last_high = highs[-1]["price"] if highs else None
    last_low = lows[-1]["price"] if lows else None
    if price is None:
        return {"lastSwingHigh": None, "lastSwingLow": None, "structureSupport": None, "structureResistance": None, "invalidationLevel": None, "levelMethod": "数据不足"}
    if not event:
        support = max((pivot["price"] for pivot in lows if pivot["price"] <= price), default=None)
        resistance = min((pivot["price"] for pivot in highs if pivot["price"] >= price), default=None)
        return {"lastSwingHigh": last_high, "lastSwingLow": last_low, "structureSupport": support, "structureResistance": resistance, "invalidationLevel": None, "levelMethod": "已确认 Swing Pivot 区间支撑/区间压力"}

    start_index = event["startPivot"]["index"]
    if event["direction"] == "up":
        trend_lows = [pivot for pivot in lows if pivot["index"] >= start_index]
        invalidation = trend_lows[-1]["price"] if trend_lows else event["startPivot"]["price"]
        support_candidates = [event["breakoutLevel"], *[pivot["price"] for pivot in trend_lows if pivot["price"] <= price]]
        support = max((value for value in support_candidates if value <= price), default=None)
        resistance = min((pivot["price"] for pivot in highs if pivot["index"] > event["breakoutIndex"] and pivot["price"] > price), default=None)
        method = "上涨结构：最近 BOS 突破位或已确认更高低点；上方最近已确认 Swing High"
    else:
        trend_highs = [pivot for pivot in highs if pivot["index"] >= start_index]
        invalidation = trend_highs[-1]["price"] if trend_highs else event["startPivot"]["price"]
        resistance_candidates = [event["breakoutLevel"], *[pivot["price"] for pivot in trend_highs if pivot["price"] >= price]]
        resistance = min((value for value in resistance_candidates if value >= price), default=invalidation)
        support = max((pivot["price"] for pivot in lows if pivot["index"] > event["breakoutIndex"] and pivot["price"] < price), default=None)
        method = "下跌结构：最近 BOS 跌破位或已确认更低高点；下方最近已确认 Swing Low"
    return {"lastSwingHigh": last_high, "lastSwingLow": last_low, "structureSupport": support, "structureResistance": resistance, "invalidationLevel": invalidation, "levelMethod": method}


def classify_trend_phase(
    direction: str,
    price: float,
    atr: float,
    ema20: float,
    event: dict[str, Any] | None,
    levels: dict[str, Any],
    last_index: int,
) -> tuple[str, float | None]:
    if direction == "insufficient_data":
        return "数据不足", None
    if direction not in {"up", "down"} or not event or atr <= 0:
        return "震荡", None
    invalidation = levels.get("invalidationLevel")
    if (direction == "up" and invalidation is not None and price < invalidation) or (direction == "down" and invalidation is not None and price > invalidation):
        return "转弱", None
    anchor = levels.get("structureSupport") if direction == "up" else levels.get("structureResistance")
    ema_distance = (price - ema20) / atr if direction == "up" else (ema20 - price) / atr
    structure_distance = ((price - anchor) / atr if direction == "up" else (anchor - price) / atr) if anchor is not None else ema_distance
    extension = max(ema_distance, structure_distance)
    if extension > float(TREND_CONFIG["extension_distance_atr"]):
        return "过度延伸", extension
    breakout_distance = abs(price - event["breakoutLevel"]) / atr
    breakout_age = last_index - event["breakoutIndex"]
    if breakout_age <= int(TREND_CONFIG["startup_max_age_bars"]) and breakout_distance <= float(TREND_CONFIG["startup_max_distance_atr"]):
        return "启动", extension
    distances = [breakout_distance]
    if anchor is not None:
        distances.append(abs(price - anchor) / atr)
    if min(distances) <= float(TREND_CONFIG["pullback_distance_atr"]):
        return "回踩", extension
    return "延续", extension


def _empty_short_trend(right_bars: int | None = None) -> dict[str, Any]:
    return {
        "direction": "insufficient_data", "phase": "数据不足", "confidence": 0,
        "startDate": None, "startPrice": None, "ageTradingDays": None, "returnSinceStartPct": None,
        "ema5": None, "ema10": None, "ema20": None, "ema5SlopePct": None,
        "breakoutLevel": None, "breakoutDate": None, "lastSwingHigh": None, "lastSwingLow": None,
        "structureSupport": None, "structureResistance": None, "invalidationLevel": None,
        "extensionAtr": None, "volumeConfirmation": "unknown",
        "confirmationLagBars": int(right_bars if right_bars is not None else TREND_CONFIG["right_bars"]),
        "levelMethod": "有效交易日少于 61，未计算趋势结构",
    }


def detect_current_short_trend(rows: Iterable[dict[str, Any]], data_as_of: str | None = None) -> dict[str, Any]:
    bars = normalize_price_rows(rows, data_as_of)
    right = int(TREND_CONFIG["right_bars"])
    if len(bars) < int(TREND_CONFIG["min_history_bars"]):
        return _empty_short_trend(right)
    closes = [bar["close"] for bar in bars]
    ema5s, ema10s, ema20s = ema_series(closes, 5), ema_series(closes, 10), ema_series(closes, 20)
    atr = atr_series(bars)[-1]
    pivots = detect_confirmed_pivots(bars)
    events = _breakout_events(bars, pivots)
    event = events[-1] if events else None
    direction = event["direction"] if event else "range"
    levels = calculate_structural_levels(bars, pivots, event)
    phase, extension = classify_trend_phase(direction, closes[-1], atr, ema20s[-1], event, levels, len(bars) - 1)
    ema5_slope = (ema5s[-1] / ema5s[-6] - 1) * 100 if len(ema5s) >= 6 and ema5s[-6] else None
    confidence = 32 if not event else 65
    if event:
        confidence += {"strong": 15, "normal": 8, "weak": -5, "unknown": 0}[event["volumeConfirmation"]]
        confidence += {"启动": 8, "延续": 6, "回踩": 5, "过度延伸": -10, "转弱": -20}.get(phase, 0)
    start = event["startPivot"] if event else None
    age = len(bars) - 1 - start["index"] if start else None
    result = {
        "direction": direction, "phase": phase, "confidence": max(0, min(100, confidence)),
        "startDate": start["date"] if start else None, "startPrice": start["price"] if start else None,
        "ageTradingDays": age, "returnSinceStartPct": ((closes[-1] / start["price"] - 1) * 100) if start else None,
        "ema5": ema5s[-1], "ema10": ema10s[-1], "ema20": ema20s[-1], "ema5SlopePct": ema5_slope,
        "breakoutLevel": event["breakoutLevel"] if event else None, "breakoutDate": event["breakoutDate"] if event else None,
        **levels, "extensionAtr": extension, "volumeConfirmation": event["volumeConfirmation"] if event else "unknown",
        "confirmationLagBars": right,
    }
    return {key: round(value, 4) if isinstance(value, float) and math.isfinite(value) else value for key, value in result.items()}


def apply_market_wind(short_trend: dict[str, Any], market_wind: dict[str, Any]) -> dict[str, Any]:
    result = dict(short_trend)
    direction, status = result.get("direction"), market_wind.get("status", "unknown")
    adjustment = 0
    if (direction == "up" and status == "risk_on") or (direction == "down" and status == "risk_off"):
        adjustment = 7
    elif (direction == "up" and status == "risk_off") or (direction == "down" and status == "risk_on"):
        adjustment = -10
    result["confidence"] = max(0, min(100, int(result.get("confidence", 0)) + adjustment))
    return result


def build_observation_plan(price: float, atr: float, short_trend: dict[str, Any]) -> dict[str, Any]:
    support = short_trend.get("structureSupport")
    resistance = short_trend.get("structureResistance")
    direction, phase = short_trend.get("direction"), short_trend.get("phase")
    if atr <= 0 or direction not in {"up", "down"}:
        target = None
    else:
        target = price + atr * float(TREND_CONFIG["atr_target_multiple"]) * (1 if direction == "up" else -1)
    wait_reason = "等待确认：仅在上涨结构、非过度延伸且风险收益达标时提供观察区间"
    result = {
        "support": support, "resistance": resistance, "buyZoneLow": None, "buyZoneHigh": None,
        "stopLoss": None, "target": target, "observationStatus": "wait", "observationReason": wait_reason,
        "levelMethod": short_trend.get("levelMethod", "已确认 Swing Pivot 结构"),
    }
    if direction != "up" or phase in {"过度延伸", "转弱", "震荡", "数据不足"} or support is None or atr <= 0:
        return result
    band = atr * float(TREND_CONFIG["observation_band_atr"])
    zone_low, zone_high = max(0.01, support - band), support + band
    invalidation = short_trend.get("invalidationLevel")
    if invalidation is None:
        return result
    stop = max(0.01, invalidation - atr * float(TREND_CONFIG["stop_buffer_atr"]))
    entry = (zone_low + zone_high) / 2
    reward_risk = (target - entry) / (entry - stop) if target is not None and entry > stop else 0.0
    if reward_risk < float(TREND_CONFIG["min_reward_risk"]):
        result["observationReason"] = f"等待确认：结构风险收益比 {reward_risk:.2f} 低于 {TREND_CONFIG['min_reward_risk']:.1f}"
        return result
    result.update({"buyZoneLow": zone_low, "buyZoneHigh": zone_high, "stopLoss": stop, "observationStatus": "ready", "observationReason": "围绕已确认突破位或结构支撑的回踩观察区；仅供研究，不构成投资建议"})
    return {key: round(value, 4) if isinstance(value, float) else value for key, value in result.items()}
