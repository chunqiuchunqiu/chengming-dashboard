import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { financeTransactions } from "../../../db/schema";
import { maskedPreview } from "../../../lib/finance/parser-core";
import { parseAlipayBill } from "../../../lib/finance/parsers/alipay";
import { parseWechatBill } from "../../../lib/finance/parsers/wechat";
import { FinanceHttpError, requireMultipart, validateBillFile } from "../../../lib/finance/security";
import { FINANCE_SOURCES, type FinanceSource, type ParsedBill } from "../../../lib/finance/types";

export async function parseFinanceUpload(request: Request): Promise<{ file: File; source: FinanceSource; parsed: ParsedBill }> {
  requireMultipart(request);
  const form = await request.formData();
  const source = String(form.get("source") || "") as FinanceSource;
  if (!FINANCE_SOURCES.includes(source)) throw new FinanceHttpError(400, "请选择微信或支付宝");
  const file = form.get("file");
  if (!(file instanceof File)) throw new FinanceHttpError(400, "请选择账单文件");
  validateBillFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = source === "wechat" ? await parseWechatBill(bytes) : await parseAlipayBill(bytes);
  return { file, source, parsed };
}

export async function existingDedupeKeys(userId: string, source: FinanceSource, keys: string[]) {
  const unique = [...new Set(keys)];
  const found = new Set<string>();
  for (let index = 0; index < unique.length; index += 80) {
    const part = unique.slice(index, index + 80);
    const rows = await getDb().select({ dedupeKey: financeTransactions.dedupeKey })
      .from(financeTransactions)
      .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.source, source), inArray(financeTransactions.dedupeKey, part)));
    rows.forEach(row => found.add(row.dedupeKey));
  }
  return found;
}

export async function buildPreview(userId: string, parsed: ParsedBill) {
  const existing = await existingDedupeKeys(userId, parsed.source, parsed.transactions.map(item => item.dedupeKey));
  const seen = new Set<string>();
  let duplicates = 0, expenseFen = 0, refundFen = 0, excludedRows = 0;
  for (const item of parsed.transactions) {
    if (existing.has(item.dedupeKey) || seen.has(item.dedupeKey)) duplicates++;
    else seen.add(item.dedupeKey);
    if (item.excluded || item.direction === "excluded") excludedRows++;
    else if (item.direction === "expense" || item.direction === "transfer") expenseFen += item.amountFen;
    else if (item.direction === "refund") refundFen += item.amountFen;
  }
  return {
    source: parsed.source,
    encoding: parsed.encoding,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    totalRows: parsed.totalRows,
    validRows: parsed.transactions.length,
    expenseRows: parsed.transactions.filter(item => !item.excluded && (item.direction === "expense" || item.direction === "transfer")).length,
    refundRows: parsed.transactions.filter(item => !item.excluded && item.direction === "refund").length,
    excludedRows,
    duplicateRows: duplicates,
    skippedRows: parsed.skippedRows,
    errorRows: parsed.errors.length,
    projectedNetExpenseFen: Math.max(0, expenseFen - refundFen),
    errors: parsed.errors.slice(0, 10),
    preview: parsed.transactions.filter(item => !existing.has(item.dedupeKey)).slice(0, 10).map(maskedPreview),
  };
}
