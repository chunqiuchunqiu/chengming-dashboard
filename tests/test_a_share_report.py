import importlib.util
import unittest
from datetime import date
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("a_share", Path(__file__).parents[1] / "scripts" / "generate_a_share_report.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ReportMathTests(unittest.TestCase):
    def test_completed_period_avoids_unpublished_reports(self):
        self.assertEqual(MODULE.latest_completed_period(date(2026, 2, 1)), "20250930")
        self.assertEqual(MODULE.latest_completed_period(date(2026, 6, 1)), "20260331")
        self.assertEqual(MODULE.latest_completed_period(date(2026, 9, 1)), "20260630")

    def test_technical_levels_are_deterministic(self):
        rows = []
        for index in range(80):
            close = 10 + index * 0.1
            rows.append({"收盘": close, "最高": close + 0.3, "最低": close - 0.2, "成交量": 1000 + index * 10})
        result = MODULE.technical_metrics(rows)
        self.assertGreater(result["ma20"], result["ma60"])
        self.assertGreater(result["target"], result["price"])
        self.assertLess(result["stopLoss"], result["price"])
        self.assertGreater(result["volumeRatio20d"], 1)

    def test_rejects_st_and_non_mainland_codes(self):
        common = {"最新价": 12, "成交额": 100_000_000, "总市值": 10_000_000_000, "市盈率-动态": 20, "市净率": 2, "换手率": 1}
        self.assertIsNone(MODULE.build_base({**common, "代码": "600001", "名称": "ST示例"}, {}))
        self.assertIsNone(MODULE.build_base({**common, "代码": "830001", "名称": "北交示例"}, {}))

    def test_normalizes_sina_prefixed_codes(self):
        self.assertEqual(MODULE.normalize_code("sh600519"), "600519")
        self.assertEqual(MODULE.normalize_code("sz000333"), "000333")

    def test_sina_spot_fallback_allows_missing_valuation(self):
        class Frame:
            empty = False

        class Ak:
            @staticmethod
            def stock_zh_a_spot_em():
                raise ConnectionError("primary unavailable")

            @staticmethod
            def stock_zh_a_spot():
                return Frame()

        original_sleep = MODULE.time.sleep
        MODULE.time.sleep = lambda _: None
        try:
            frame, provider = MODULE.spot_market(Ak(), attempts=1)
        finally:
            MODULE.time.sleep = original_sleep
        self.assertIsInstance(frame, Frame)
        self.assertIn("新浪", provider)
        base = MODULE.build_base({"代码": "sh600001", "名称": "示例", "最新价": 12, "成交额": 100_000_000}, {})
        self.assertIsNotNone(base)
        self.assertEqual(base["pe"], 0)

    def test_sina_history_can_skip_known_unavailable_primary(self):
        calls = []

        class Frame:
            pass

        class Ak:
            @staticmethod
            def stock_zh_a_hist(**_kwargs):
                calls.append("eastmoney")
                raise AssertionError("known unavailable provider should be skipped")

            @staticmethod
            def stock_zh_a_daily(**kwargs):
                calls.append(kwargs["symbol"])
                return Frame()

        frame, provider = MODULE.history_frame(Ak(), "600519", "20260101", "20260814", prefer_sina=True)
        self.assertIsInstance(frame, Frame)
        self.assertEqual(calls, ["sh600519"])
        self.assertIn("新浪", provider)


if __name__ == "__main__":
    unittest.main()
