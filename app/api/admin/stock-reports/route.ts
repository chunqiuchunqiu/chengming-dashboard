import { env } from "cloudflare:workers";
import { stockReports } from "../../../../db/schema";
import { getDb } from "../../../../db";

export const dynamic = "force-dynamic";

type StockPick = { code?: unknown; name?: unknown; rank?: unknown; score?: unknown; shortTrend?: unknown };
type ReportPayload = {
  schemaVersion?: unknown; isoYearWeek?: unknown; market?: unknown; status?: unknown;
  dataAsOf?: unknown; generatedAt?: unknown; dataProvider?: unknown; summaryProvider?: unknown;
  marketWind?: unknown; stocks?: unknown;
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

function validateShortTrend(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("schemaVersion=2 缺少 shortTrend");
  const trend = value as Record<string, unknown>;
  const directions = new Set(["up", "down", "range", "transition", "insufficient_data"]);
  const phases = new Set(["启动", "延续", "回踩", "过度延伸", "转弱", "震荡", "数据不足"]);
  const volumes = new Set(["strong", "normal", "weak", "unknown"]);
  if (!directions.has(String(trend.direction)) || !phases.has(String(trend.phase)) || !volumes.has(String(trend.volumeConfirmation))) throw new Error("shortTrend 枚举字段无效");
  if (!Number.isFinite(Number(trend.confidence)) || Number(trend.confidence) < 0 || Number(trend.confidence) > 100) throw new Error("shortTrend.confidence 无效");
  if (!Number.isInteger(Number(trend.confirmationLagBars)) || Number(trend.confirmationLagBars) < 1) throw new Error("shortTrend.confirmationLagBars 无效");
  const nullableNumbers = ["startPrice", "ageTradingDays", "returnSinceStartPct", "ema5", "ema10", "ema20", "ema5SlopePct", "breakoutLevel", "lastSwingHigh", "lastSwingLow", "structureSupport", "structureResistance", "invalidationLevel", "extensionAtr"];
  for (const key of nullableNumbers) {
    if (trend[key] !== null && !Number.isFinite(Number(trend[key]))) throw new Error(`shortTrend.${key} 无效`);
  }
  for (const key of ["startDate", "breakoutDate"]) {
    if (trend[key] !== null && typeof trend[key] !== "string") throw new Error(`shortTrend.${key} 无效`);
  }
  textField(trend.levelMethod, "shortTrend.levelMethod", 240);
}

function validateMarketWind(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("schemaVersion=2 缺少 marketWind");
  const wind = value as Record<string, unknown>;
  if (!["risk_on", "neutral", "risk_off", "unknown"].includes(String(wind.status))) throw new Error("marketWind.status 无效");
  if (wind.score !== null && (!Number.isFinite(Number(wind.score)) || Number(wind.score) < 0 || Number(wind.score) > 100)) throw new Error("marketWind.score 无效");
  if (!Array.isArray(wind.indices) || wind.indices.length !== 3) throw new Error("marketWind.indices 必须包含 3 个指数");
}

function validate(payload: ReportPayload) {
  const schemaVersion = payload.schemaVersion == null ? 1 : Number(payload.schemaVersion);
  if (![1, 2].includes(schemaVersion)) throw new Error("schemaVersion 仅支持 1 或 2");
  const isoYearWeek = textField(payload.isoYearWeek, "isoYearWeek", 16);
  if (!/^\d{4}-W\d{2}$/.test(isoYearWeek)) throw new Error("isoYearWeek 格式无效");
  const dataAsOf = textField(payload.dataAsOf, "dataAsOf", 32);
  const generatedAt = textField(payload.generatedAt, "generatedAt", 40);
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("generatedAt 格式无效");
  if (!Array.isArray(payload.stocks) || payload.stocks.length < 1 || payload.stocks.length > 10) throw new Error("stocks 必须包含 1 到 10 只股票");
  for (const item of payload.stocks as StockPick[]) {
    if (!/^\d{6}$/.test(String(item.code || "")) || typeof item.name !== "string") throw new Error("股票代码或名称无效");
    if (!Number.isFinite(Number(item.rank)) || !Number.isFinite(Number(item.score))) throw new Error("股票排名或评分无效");
    if (schemaVersion === 2) validateShortTrend(item.shortTrend);
  }
  if (schemaVersion === 2) validateMarketWind(payload.marketWind);
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
