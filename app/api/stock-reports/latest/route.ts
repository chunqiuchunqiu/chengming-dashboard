import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { stockReports } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [row] = await getDb().select().from(stockReports)
      .where(eq(stockReports.status, "success"))
      .orderBy(desc(stockReports.generatedAt)).limit(1);
    if (!row) return Response.json({ report: null, source: "Cloudflare D1" });
    return Response.json({ report: JSON.parse(row.reportJson), source: "Cloudflare D1" }, {
      headers: { "cache-control": "private, max-age=300" },
    });
  } catch {
    return Response.json({ error: "股票周报暂不可用" }, { status: 500 });
  }
}
