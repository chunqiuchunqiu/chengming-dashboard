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


if __name__ == "__main__":
    unittest.main()
