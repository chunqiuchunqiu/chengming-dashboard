import importlib.util
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("a_share", Path(__file__).parents[1] / "scripts" / "generate_a_share_report.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def make_bars(closes, *, volumes=None, start=date(2026, 1, 1)):
    volumes = volumes or [1_000.0] * len(closes)
    return [
        {
            "日期": (start + timedelta(days=index)).isoformat(),
            "收盘": close,
            "最高": close + 0.15,
            "最低": close - 0.15,
            "成交量": volumes[index],
        }
        for index, close in enumerate(closes)
    ]


def uptrend_closes(tail=None):
    prefix = [10 + index * 0.005 for index in range(45)]
    structure = [10.4, 10.7, 11.0, 11.4, 11.7, 12.0, 11.7, 11.4, 11.1, 10.8, 10.5, 10.2, 10.5, 10.8, 11.2, 11.6, 12.3]
    return prefix + structure + (tail if tail is not None else [12.45, 12.6, 12.7])


def downtrend_closes():
    prefix = [12 - index * 0.005 for index in range(45)]
    structure = [11.6, 11.3, 11.0, 10.6, 10.3, 10.0, 10.3, 10.6, 10.9, 11.2, 11.5, 11.8, 11.5, 11.2, 10.8, 10.4, 9.8, 9.65, 9.5, 9.4]
    return prefix + structure


class Frame:
    def __init__(self, rows):
        self.rows = rows
        self.empty = not rows

    def to_dict(self, _kind):
        return self.rows


class ReportMathTests(unittest.TestCase):
    def test_completed_period_avoids_unpublished_reports(self):
        self.assertEqual(MODULE.latest_completed_period(date(2026, 2, 1)), "20250930")
        self.assertEqual(MODULE.latest_completed_period(date(2026, 6, 1)), "20260331")
        self.assertEqual(MODULE.latest_completed_period(date(2026, 9, 1)), "20260630")

    def test_intraday_cutoff_excludes_unfinished_daily_bar(self):
        before_close = datetime(2026, 8, 14, 14, 30, tzinfo=timezone(timedelta(hours=8)))
        after_close = datetime(2026, 8, 14, 15, 20, tzinfo=timezone(timedelta(hours=8)))
        self.assertEqual(MODULE.completed_daily_cutoff(before_close), date(2026, 8, 13))
        self.assertEqual(MODULE.completed_daily_cutoff(after_close), date(2026, 8, 14))

    def test_uptrend_bos_finds_confirmed_start_low(self):
        result = MODULE.detect_current_short_trend(make_bars(uptrend_closes()))
        self.assertEqual(result["direction"], "up")
        self.assertEqual(result["startPrice"], 10.05)
        self.assertEqual(result["startDate"], "2026-02-26")
        self.assertEqual(result["breakoutDate"], "2026-03-03")
        self.assertEqual(result["confirmationLagBars"], 3)

    def test_downtrend_bos_finds_confirmed_start_high(self):
        result = MODULE.detect_current_short_trend(make_bars(downtrend_closes()))
        self.assertEqual(result["direction"], "down")
        self.assertEqual(result["startPrice"], 11.95)
        self.assertEqual(result["startDate"], "2026-02-26")
        self.assertIsNotNone(result["breakoutLevel"])

    def test_range_does_not_invent_trend_start(self):
        closes = [10.0, 10.2, 10.4, 10.2] * 20
        result = MODULE.detect_current_short_trend(make_bars(closes))
        self.assertEqual(result["direction"], "range")
        self.assertEqual(result["phase"], "震荡")
        self.assertIsNone(result["startDate"])
        self.assertIsNone(result["startPrice"])

    def test_new_high_has_no_confirmed_structural_resistance(self):
        result = MODULE.technical_metrics(make_bars(uptrend_closes([12.45, 12.6, 12.8, 13.0])))
        self.assertEqual(result["shortTrend"]["direction"], "up")
        self.assertIsNone(result["resistance"])
        self.assertIsNotNone(result["target"])

    def test_breakout_pullback_is_classified_at_structure_support(self):
        tail = [12.6, 12.9, 13.0, 12.85, 12.65, 12.4, 12.25, 12.18]
        result = MODULE.detect_current_short_trend(make_bars(uptrend_closes(tail)))
        self.assertEqual(result["direction"], "up")
        self.assertEqual(result["phase"], "回踩")
        self.assertAlmostEqual(result["structureSupport"], result["breakoutLevel"])

    def test_overextended_price_is_flagged(self):
        tail = [12.8, 13.4, 14.1, 14.8, 15.4, 16.0]
        result = MODULE.detect_current_short_trend(make_bars(uptrend_closes(tail)))
        self.assertEqual(result["direction"], "up")
        self.assertEqual(result["phase"], "过度延伸")
        self.assertGreater(result["extensionAtr"], MODULE.TREND_CONFIG["extension_distance_atr"])

    def test_pivot_waits_for_all_right_bars(self):
        closes = [9.6, 9.8, 10.0, 10.5, 11.0, 10.7, 10.4, 10.1]
        full = MODULE.normalize_price_rows(make_bars(closes))
        early = MODULE.detect_confirmed_pivots(full[:-1], min_swing_pct=0, min_swing_atr=0)
        confirmed = MODULE.detect_confirmed_pivots(full, min_swing_pct=0, min_swing_atr=0)
        self.assertFalse(any(pivot["index"] == 4 for pivot in early))
        pivot = next(pivot for pivot in confirmed if pivot["index"] == 4)
        self.assertEqual(pivot["confirmationIndex"], 7)
        self.assertEqual(pivot["confirmationLagBars"], 3)

    def test_less_than_61_valid_bars_is_explicit(self):
        result = MODULE.detect_current_short_trend(make_bars([10 + index * 0.01 for index in range(60)]))
        self.assertEqual(result["direction"], "insufficient_data")
        self.assertEqual(result["phase"], "数据不足")
        self.assertEqual(result["confidence"], 0)

    def test_normalization_handles_duplicate_disorder_missing_volume_and_bad_values(self):
        rows = [
            {"日期": "2026-01-03", "收盘": 10.3, "最高": 10.5, "最低": 10.1, "成交量": ""},
            {"日期": "2026-01-01", "收盘": 10.0, "最高": 10.2, "最低": 9.8, "成交量": 100},
            {"日期": "2026-01-02", "收盘": 10.1, "最高": 10.2, "最低": 10.0, "成交量": 100},
            {"日期": "2026-01-02", "收盘": 10.15, "最高": 10.3, "最低": 10.0, "成交量": 200},
            {"日期": "2026-01-04", "收盘": -1, "最高": 1, "最低": -2, "成交量": 300},
            {"日期": "bad", "收盘": 10, "最高": 11, "最低": 9, "成交量": 300},
        ]
        result = MODULE.normalize_price_rows(reversed(rows), "2026-01-03")
        self.assertEqual([bar["date"] for bar in result], ["2026-01-01", "2026-01-02", "2026-01-03"])
        self.assertEqual(result[1]["close"], 10.15)
        self.assertEqual(result[2]["volume"], 0)

    def test_market_wind_failure_degrades_and_report_still_generates(self):
        class BrokenIndexAk:
            @staticmethod
            def stock_zh_index_daily_tx(**_kwargs):
                raise ConnectionError("index provider unavailable")

        wind = MODULE.load_market_wind(BrokenIndexAk(), "20260101", "20260814", "2026-08-14")
        self.assertEqual(wind["status"], "unknown")
        self.assertTrue(all(item["status"] == "unknown" for item in wind["indices"]))

        base = {
            "code": "600001", "name": "脱敏样例", "industry": "示例行业", "price": 12.7,
            "pe": 20, "pb": 2, "marketCapYi": 100, "turnoverRate": 1.2,
            "revenueGrowth": 8, "profitGrowth": 10, "roe": 9,
            "operatingCashFlowPerShare": 1, "grossMargin": 20,
            "fundamentalCoverage": True, "amount": 100_000_000,
        }
        originals = MODULE.load_market, MODULE.history_frame, MODULE.enrich_with_deepseek
        MODULE.load_market = lambda _ak: ([base], "20260331", "2026-08-14", "测试只读行情")
        MODULE.history_frame = lambda *_args, **_kwargs: (Frame(make_bars(uptrend_closes())), "测试前复权历史")
        MODULE.enrich_with_deepseek = lambda _report: None
        try:
            report = MODULE.generate_report(BrokenIndexAk())
        finally:
            MODULE.load_market, MODULE.history_frame, MODULE.enrich_with_deepseek = originals
        self.assertEqual(report["schemaVersion"], 2)
        self.assertEqual(report["marketWind"]["status"], "unknown")
        self.assertEqual(len(report["stocks"]), 1)

    def test_same_input_is_bit_for_bit_deterministic(self):
        rows = make_bars(uptrend_closes())
        first = MODULE.detect_current_short_trend(rows)
        second = MODULE.detect_current_short_trend(list(reversed(rows)))
        self.assertEqual(first, second)

    def test_technical_fields_and_score_split_remain_compatible(self):
        rows = make_bars(uptrend_closes())
        result = MODULE.technical_metrics(rows)
        self.assertGreater(result["ma20"], result["ma60"])
        self.assertIn("Swing", result["levelMethod"])
        self.assertNotIn(min(bar["最低"] for bar in rows[-20:]), {result["support"]})
        base = {"revenueGrowth": 10, "profitGrowth": 12, "roe": 9, "pe": 20, "pb": 2}
        _score, breakdown, detail = MODULE.score_pick(base, result)
        self.assertEqual(breakdown["trend"], detail["mediumTerm"] + detail["shortTerm"])
        self.assertLessEqual(detail["mediumTerm"], 15)
        self.assertLessEqual(detail["shortTerm"], 20)

    def test_rejects_st_and_non_mainland_codes(self):
        common = {"最新价": 12, "成交额": 100_000_000, "总市值": 10_000_000_000, "市盈率-动态": 20, "市净率": 2, "换手率": 1}
        self.assertIsNone(MODULE.build_base({**common, "代码": "600001", "名称": "ST示例"}, {}))
        self.assertIsNone(MODULE.build_base({**common, "代码": "830001", "名称": "北交示例"}, {}))

    def test_normalizes_sina_prefixed_codes(self):
        self.assertEqual(MODULE.normalize_code("sh600519"), "600519")
        self.assertEqual(MODULE.normalize_code("sz000333"), "000333")

    def test_sina_spot_fallback_allows_missing_valuation(self):
        class EmptyFrame:
            empty = False

        class Ak:
            @staticmethod
            def stock_zh_a_spot_em():
                raise ConnectionError("primary unavailable")

            @staticmethod
            def stock_zh_a_spot():
                return EmptyFrame()

        original_sleep = MODULE.time.sleep
        MODULE.time.sleep = lambda _: None
        try:
            frame, provider = MODULE.spot_market(Ak(), attempts=1)
        finally:
            MODULE.time.sleep = original_sleep
        self.assertIsInstance(frame, EmptyFrame)
        self.assertIn("新浪", provider)
        base = MODULE.build_base({"代码": "sh600001", "名称": "示例", "最新价": 12, "成交额": 100_000_000}, {})
        self.assertIsNotNone(base)
        self.assertEqual(base["pe"], 0)

    def test_sina_history_can_skip_known_unavailable_primary(self):
        calls = []

        class Ak:
            @staticmethod
            def stock_zh_a_hist(**_kwargs):
                calls.append("eastmoney")
                raise AssertionError("known unavailable provider should be skipped")

            @staticmethod
            def stock_zh_a_daily(**kwargs):
                calls.append(kwargs["symbol"])
                return Frame([])

        frame, provider = MODULE.history_frame(Ak(), "600519", "20260101", "20260814", prefer_sina=True)
        self.assertIsInstance(frame, Frame)
        self.assertEqual(calls, ["sh600519"])
        self.assertIn("新浪", provider)


if __name__ == "__main__":
    unittest.main()
