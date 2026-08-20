import type { Direction, TransactionSource } from "./types";

export type FinanceStatRow = {
  source: TransactionSource;
  direction: Direction;
  amountFen: number;
  excluded: boolean;
  normalizedCategory: string;
  occurredAt: string;
};

export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("月份格式应为 YYYY-MM");
  const [year, value] = month.split("-").map(Number);
  const nextYear = value === 12 ? year + 1 : year;
  const nextMonth = value === 12 ? 1 : value + 1;
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`,
  };
}

export function summarizeRows(rows: FinanceStatRow[]) {
  let manualIncomeFen = 0, wechatExpenseFen = 0, alipayExpenseFen = 0, refundsFen = 0;
  const categories = new Map<string, number>();
  const daily = new Map<string, number>();
  for (const row of rows) {
    if (row.excluded) continue;
    let cashflow = 0;
    if (row.source === "manual" && row.direction === "income") { manualIncomeFen += row.amountFen; cashflow = row.amountFen; }
    if (row.direction === "expense" || row.direction === "transfer") {
      if (row.source === "wechat") wechatExpenseFen += row.amountFen;
      if (row.source === "alipay") alipayExpenseFen += row.amountFen;
      categories.set(row.normalizedCategory, (categories.get(row.normalizedCategory) || 0) + row.amountFen);
      cashflow = -row.amountFen;
    }
    if (row.direction === "refund") {
      refundsFen += row.amountFen;
      categories.set(row.normalizedCategory, (categories.get(row.normalizedCategory) || 0) - row.amountFen);
      cashflow = row.amountFen;
    }
    const date = row.occurredAt.slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + cashflow);
  }
  const grossExpenseFen = wechatExpenseFen + alipayExpenseFen;
  const netExpenseFen = Math.max(0, grossExpenseFen - refundsFen);
  return {
    manualIncomeFen, wechatExpenseFen, alipayExpenseFen, refundsFen, grossExpenseFen, netExpenseFen,
    netCashflowFen: manualIncomeFen - netExpenseFen,
    categories: [...categories].map(([category, amountFen]) => ({ category, amountFen })).filter(item => item.amountFen !== 0).sort((a, b) => Math.abs(b.amountFen) - Math.abs(a.amountFen)),
    daily: [...daily].map(([date, netCashflowFen]) => ({ date, netCashflowFen })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
