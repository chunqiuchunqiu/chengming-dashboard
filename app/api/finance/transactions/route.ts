import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { financeTransactions } from "../../../../db/schema";
import { cleanText, financeErrorResponse, FinanceHttpError, requireJson, requireSameOrigin, requireUserId } from "../../../../lib/finance/security";
import { INCOME_CATEGORIES, NORMALIZED_CATEGORIES, type IncomeCategory, type NormalizedCategory } from "../../../../lib/finance/types";
import { monthBounds } from "../../../../lib/finance/stats";

export const dynamic = "force-dynamic";

function manualPayload(payload: Record<string, unknown>) {
  const amountFen = Number(payload.amountFen);
  if (!Number.isSafeInteger(amountFen) || amountFen <= 0 || amountFen > 100_000_000_00) throw new FinanceHttpError(400, "金额必须是有效的正整数分");
  const occurredAt = cleanText(payload.occurredAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+08:00$/.test(occurredAt) || Number.isNaN(new Date(occurredAt).getTime())) throw new FinanceHttpError(400, "日期时间无效");
  const incomeType = cleanText(payload.incomeType, 20) as IncomeCategory;
  if (!INCOME_CATEGORIES.includes(incomeType)) throw new FinanceHttpError(400, "收入类型无效");
  return { amountFen, occurredAt, incomeType, counterparty: cleanText(payload.counterparty, 100), notes: cleanText(payload.notes, 1000) };
}

export async function GET(request: Request) {
  try {
    const userId = requireUserId(request);
    const url = new URL(request.url);
    const month = url.searchParams.get("month");
    const date = url.searchParams.get("date");
    let range: { start: string; end: string } | null = null;
    if (month) range = monthBounds(month);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FinanceHttpError(400, "日期格式应为 YYYY-MM-DD");
      const next = new Date(`${date}T00:00:00+08:00`); next.setUTCDate(next.getUTCDate() + 1);
      range = { start: `${date}T00:00:00+08:00`, end: next.toISOString().slice(0, 10) + "T00:00:00+08:00" };
    }
    const where = range
      ? and(eq(financeTransactions.userId, userId), gte(financeTransactions.occurredAt, range.start), lt(financeTransactions.occurredAt, range.end))
      : eq(financeTransactions.userId, userId);
    const rows = await getDb().select().from(financeTransactions).where(where).orderBy(desc(financeTransactions.occurredAt)).limit(500);
    return Response.json({ transactions: rows, source: "Cloudflare D1 标准化流水", updatedAt: new Date().toISOString() });
  } catch (error) { return financeErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const userId = requireUserId(request); requireSameOrigin(request); requireJson(request);
    const clean = manualPayload(await request.json() as Record<string, unknown>);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const row = {
      id, userId, source: "manual" as const, externalId: null, dedupeKey: `manual:${id}`, importBatchId: null,
      occurredAt: clean.occurredAt, direction: "income" as const, amountFen: clean.amountFen, currency: "CNY",
      counterparty: clean.counterparty, description: clean.incomeType, originalCategory: clean.incomeType,
      normalizedCategory: "其他", categoryOverride: false, paymentMethodMasked: "", transactionStatus: "手动记录",
      excluded: false, excludedReason: "", notes: clean.notes, createdAt: now, updatedAt: now,
    };
    await getDb().insert(financeTransactions).values(row);
    return Response.json({ transaction: row }, { status: 201 });
  } catch (error) { return financeErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const userId = requireUserId(request); requireSameOrigin(request); requireJson(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanText(payload.id, 100);
    if (!id) throw new FinanceHttpError(400, "流水 id 不能为空");
    const existing = await getDb().select().from(financeTransactions)
      .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId))).limit(1);
    if (!existing.length) throw new FinanceHttpError(404, "流水不存在");
    const current = existing[0];
    const updatedAt = new Date().toISOString();
    if (current.source === "manual") {
      const clean = manualPayload(payload);
      await getDb().update(financeTransactions).set({ amountFen: clean.amountFen, occurredAt: clean.occurredAt, description: clean.incomeType, originalCategory: clean.incomeType, counterparty: clean.counterparty, notes: clean.notes, updatedAt })
        .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId), eq(financeTransactions.source, "manual")));
    } else {
      const normalizedCategory = cleanText(payload.normalizedCategory, 30) as NormalizedCategory;
      if (!NORMALIZED_CATEGORIES.includes(normalizedCategory)) throw new FinanceHttpError(400, "分类无效");
      const excluded = payload.excluded === true;
      const notes = cleanText(payload.notes, 1000);
      await getDb().update(financeTransactions).set({ normalizedCategory, categoryOverride: true, excluded, excludedReason: excluded ? "用户手动排除" : "", notes, updatedAt })
        .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)));
    }
    return Response.json({ updated: true, id });
  } catch (error) { return financeErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireUserId(request); requireSameOrigin(request);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id || id.length > 100) throw new FinanceHttpError(400, "流水 id 无效");
    const result = await getDb().delete(financeTransactions).where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId), eq(financeTransactions.source, "manual"))).returning({ id: financeTransactions.id });
    if (!result.length) throw new FinanceHttpError(404, "只能删除本人手动收入记录");
    return Response.json({ deleted: true });
  } catch (error) { return financeErrorResponse(error); }
}
