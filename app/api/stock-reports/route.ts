import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { stockReports } from "../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requested = Number(new URL(request.url).searchParams.get("limit") || 12);
    const limit = Math.max(1, Math.min(52, Number.isFinite(requested) ? requested : 12));
    const rows = await getDb().select({
      isoYearWeek: stockReports.isoYearWeek,
      market: stockReports.market,
      status: stockReports.status,
      dataAsOf: stockReports.dataAsOf,
      generatedAt: stockReports.generatedAt,
      dataProvider: stockReports.dataProvider,
      summaryProvider: stockReports.summaryProvider,
    }).from(stockReports).orderBy(desc(stockReports.generatedAt)).limit(limit);
    return Response.json({ reports: rows, source: "Cloudflare D1" });
  } catch {
    return Response.json({ error: "股票周报列表暂不可用" }, { status: 500 });
  }
}
