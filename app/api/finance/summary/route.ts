import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { financeImportBatches, financeTransactions } from "../../../../db/schema";
import { financeErrorResponse, FinanceHttpError, requireUserId } from "../../../../lib/finance/security";
import { monthBounds, summarizeRows } from "../../../../lib/finance/stats";

export const dynamic = "force-dynamic";

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return value === 1 ? `${year - 1}-12` : `${year}-${String(value - 1).padStart(2, "0")}`;
}

function comparison(current: number, previous: number) {
  return { currentFen: current, previousFen: previous, changeFen: current - previous, changePct: previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 };
}

export async function GET(request: Request) {
  try {
    const userId = requireUserId(request);
    const month = new URL(request.url).searchParams.get("month") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
    let currentBounds;
    try { currentBounds = monthBounds(month); } catch { throw new FinanceHttpError(400, "月份格式应为 YYYY-MM"); }
    const prevMonth = previousMonth(month);
    const prevBounds = monthBounds(prevMonth);
    const rows = await getDb().select().from(financeTransactions)
      .where(and(eq(financeTransactions.userId, userId), gte(financeTransactions.occurredAt, prevBounds.start), lt(financeTransactions.occurredAt, currentBounds.end)))
      .orderBy(asc(financeTransactions.occurredAt));
    const current = summarizeRows(rows.filter(row => row.occurredAt >= currentBounds.start));
    const previous = summarizeRows(rows.filter(row => row.occurredAt < currentBounds.start));
    const recent = await getDb().select().from(financeTransactions).where(eq(financeTransactions.userId, userId)).orderBy(desc(financeTransactions.occurredAt)).limit(12);
    const latestImports = await getDb().select().from(financeImportBatches).where(eq(financeImportBatches.userId, userId)).orderBy(desc(financeImportBatches.createdAt)).limit(20);
    const coverage = latestImports.length ? { start: [...latestImports].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0].periodStart, end: [...latestImports].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0].periodEnd } : null;
    return Response.json({
      month,
      summary: current,
      comparisons: {
        income: comparison(current.manualIncomeFen, previous.manualIncomeFen),
        expense: comparison(current.netExpenseFen, previous.netExpenseFen),
        cashflow: comparison(current.netCashflowFen, previous.netCashflowFen),
      },
      recent,
      coverage,
      latestImport: latestImports[0] || null,
      source: "Cloudflare D1 标准化流水；微信/支付宝官方导出文件与手动收入",
      updatedAt: new Date().toISOString(),
      timezone: "Asia/Shanghai",
    });
  } catch (error) { return financeErrorResponse(error); }
}
