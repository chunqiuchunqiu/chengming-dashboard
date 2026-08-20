import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { financeImportBatches, financeTransactions } from "../../../../db/schema";
import { safeFileName, financeErrorResponse, FinanceHttpError, requireSameOrigin, requireUserId } from "../../../../lib/finance/security";
import { existingDedupeKeys, parseFinanceUpload } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = requireUserId(request);
    const rows = await getDb().select().from(financeImportBatches)
      .where(eq(financeImportBatches.userId, userId)).orderBy(desc(financeImportBatches.createdAt)).limit(100);
    return Response.json({ imports: rows, source: "Cloudflare D1 标准化导入记录", updatedAt: new Date().toISOString() });
  } catch (error) { return financeErrorResponse(error); }
}

export async function POST(request: Request) {
  let batchId = "";
  let userId = "";
  try {
    userId = requireUserId(request);
    requireSameOrigin(request);
    const { file, source, parsed } = await parseFinanceUpload(request);
    const unique = new Map(parsed.transactions.map(item => [item.dedupeKey, item]));
    const existing = await existingDedupeKeys(userId, source, [...unique.keys()]);
    const pending = [...unique.values()].filter(item => !existing.has(item.dedupeKey));
    batchId = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb().insert(financeImportBatches).values({
      id: batchId, userId, source, safeFileName: safeFileName(file.name), fileHash: parsed.fileHash,
      periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, totalRows: parsed.totalRows,
      insertedRows: 0, duplicateRows: parsed.transactions.length - pending.length, skippedRows: parsed.skippedRows,
      errorRows: parsed.errors.length, status: "importing", createdAt: now,
    });

    let insertedRows = 0;
    for (let index = 0; index < pending.length; index += 100) {
      const queries = pending.slice(index, index + 100).map(item => getDb().insert(financeTransactions).values({
        id: crypto.randomUUID(), userId, importBatchId: batchId, ...item, createdAt: now, updatedAt: now,
      }).onConflictDoNothing().returning({ id: financeTransactions.id }));
      if (queries.length) {
        const results = await getDb().batch(queries as [typeof queries[number], ...typeof queries]);
        insertedRows += results.reduce((count, result) => count + (Array.isArray(result) ? result.length : 0), 0);
      }
    }
    const duplicateRows = parsed.transactions.length - insertedRows;
    await getDb().update(financeImportBatches).set({ insertedRows, duplicateRows, status: "completed" })
      .where(and(eq(financeImportBatches.id, batchId), eq(financeImportBatches.userId, userId)));
    return Response.json({ result: { id: batchId, insertedRows, duplicateRows, skippedRows: parsed.skippedRows, errorRows: parsed.errors.length }, source: "Cloudflare D1 标准化流水", updatedAt: new Date().toISOString() }, { status: 201 });
  } catch (error) {
    if (batchId && userId) {
      try { await getDb().update(financeImportBatches).set({ status: "failed" }).where(and(eq(financeImportBatches.id, batchId), eq(financeImportBatches.userId, userId))); } catch { /* avoid leaking secondary error */ }
    }
    return financeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireUserId(request);
    requireSameOrigin(request);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id || id.length > 100) throw new FinanceHttpError(400, "导入记录 id 无效");
    const owned = await getDb().select({ id: financeImportBatches.id }).from(financeImportBatches)
      .where(and(eq(financeImportBatches.id, id), eq(financeImportBatches.userId, userId))).limit(1);
    if (!owned.length) throw new FinanceHttpError(404, "导入记录不存在");
    await getDb().batch([
      getDb().delete(financeTransactions).where(and(eq(financeTransactions.importBatchId, id), eq(financeTransactions.userId, userId))),
      getDb().delete(financeImportBatches).where(and(eq(financeImportBatches.id, id), eq(financeImportBatches.userId, userId))),
    ]);
    return Response.json({ deleted: true });
  } catch (error) { return financeErrorResponse(error); }
}
