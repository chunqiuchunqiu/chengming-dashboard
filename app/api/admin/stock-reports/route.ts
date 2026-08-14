import { env } from "cloudflare:workers";
import { stockReports } from "../../../../db/schema";
import { getDb } from "../../../../db";

export const dynamic = "force-dynamic";

type StockPick = { code?: unknown; name?: unknown; rank?: unknown; score?: unknown };
type ReportPayload = {
  schemaVersion?: unknown; isoYearWeek?: unknown; market?: unknown; status?: unknown;
  dataAsOf?: unknown; generatedAt?: unknown; dataProvider?: unknown; summaryProvider?: unknown;
  stocks?: unknown;
};

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorized(request: Request) {
  const expected = env.REPORT_INGEST_SECRET || "";
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !supplied) return false;
  const [a, b] = await Promise.all([digest(expected), digest(supplied)]);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function textField(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 不能为空`);
  return value.trim().slice(0, max);
}

function validate(payload: ReportPayload) {
  const isoYearWeek = textField(payload.isoYearWeek, "isoYearWeek", 16);
  if (!/^\d{4}-W\d{2}$/.test(isoYearWeek)) throw new Error("isoYearWeek 格式无效");
  const dataAsOf = textField(payload.dataAsOf, "dataAsOf", 32);
  const generatedAt = textField(payload.generatedAt, "generatedAt", 40);
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("generatedAt 格式无效");
  if (!Array.isArray(payload.stocks) || payload.stocks.length < 1 || payload.stocks.length > 10) throw new Error("stocks 必须包含 1 到 10 只股票");
  for (const item of payload.stocks as StockPick[]) {
    if (!/^\d{6}$/.test(String(item.code || "")) || typeof item.name !== "string") throw new Error("股票代码或名称无效");
    if (!Number.isFinite(Number(item.rank)) || !Number.isFinite(Number(item.score))) throw new Error("股票排名或评分无效");
  }
  return {
    isoYearWeek,
    market: textField(payload.market || "A股", "market", 20),
    status: payload.status === "partial" ? "partial" : "success",
    dataAsOf,
    generatedAt,
    dataProvider: textField(payload.dataProvider, "dataProvider", 160),
    summaryProvider: textField(payload.summaryProvider, "summaryProvider", 160),
  };
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return Response.json({ error: "未授权" }, { status: 401 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 150_000) return Response.json({ error: "报告体积过大" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 150_000) return Response.json({ error: "报告体积过大" }, { status: 413 });
    const payload = JSON.parse(raw) as ReportPayload;
    const clean = validate(payload);
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), ...clean, reportJson: JSON.stringify(payload), errorMessage: "", createdAt: now, updatedAt: now,
    };
    await getDb().insert(stockReports).values(row).onConflictDoUpdate({
      target: stockReports.isoYearWeek,
      set: { ...clean, reportJson: row.reportJson, errorMessage: "", updatedAt: now },
    });
    return Response.json({ stored: true, isoYearWeek: clean.isoYearWeek }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "报告格式无效";
    return Response.json({ error: message }, { status: 400 });
  }
}
