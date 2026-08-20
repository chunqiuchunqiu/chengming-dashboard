import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("D1 schema 包含资金批次、流水、用户时间索引和用户去重唯一索引", async () => {
  const source = await read("db/schema.ts");
  for (const token of ["finance_import_batches", "finance_transactions", "finance_transactions_user_occurred_idx", "finance_transactions_user_source_dedupe_unique"]) assert.ok(source.includes(token), token);
});

test("资金 API 全部使用服务端身份且无 local-preview 回退", async () => {
  const routes = await Promise.all(["summary/route.ts", "transactions/route.ts", "imports/route.ts", "imports/preview/route.ts"].map(name => read(`app/api/finance/${name}`)));
  routes.forEach(source => assert.ok(source.includes("requireUserId(request)")));
  assert.ok(routes.every(source => !source.includes("local-preview")));
});

test("跨用户隔离：查询、更新与删除均包含 userId 条件", async () => {
  const transactions = await read("app/api/finance/transactions/route.ts");
  const imports = await read("app/api/finance/imports/route.ts");
  assert.match(transactions, /eq\(financeTransactions\.userId, userId\)/);
  assert.match(imports, /eq\(financeImportBatches\.userId, userId\)/);
  assert.match(imports, /eq\(financeTransactions\.userId, userId\)/);
});

test("删除导入批次只删除本人批次流水，不删除手动收入或其他用户", async () => {
  const source = await read("app/api/finance/imports/route.ts");
  assert.match(source, /financeTransactions\.importBatchId, id/);
  assert.match(source, /financeTransactions\.userId, userId/);
  assert.doesNotMatch(source, /delete\(financeTransactions\)(?![\s\S]*importBatchId)/);
});

test("手动收入接口新增、修改、删除均限制 source=manual", async () => {
  const source = await read("app/api/finance/transactions/route.ts");
  assert.ok(source.includes('source: "manual" as const'));
  assert.ok(source.includes('eq(financeTransactions.source, "manual")'));
  assert.ok(source.includes("只能删除本人手动收入记录"));
});

test("导入预览不写数据库，确认导入使用 D1 batch", async () => {
  const preview = await read("app/api/finance/imports/preview/route.ts");
  const confirm = await read("app/api/finance/imports/route.ts");
  assert.doesNotMatch(preview, /insert\(|update\(|delete\(/);
  assert.ok(confirm.includes("getDb().batch"));
});

test("R2 保持未配置，原始账单没有持久化路径", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  assert.equal(hosting.r2, null);
  const routes = await Promise.all(["app/api/finance/_shared.ts", "app/api/finance/imports/route.ts"].map(read));
  assert.ok(routes.every(source => !/R2|put\(|writeFile|arrayBuffer\(\).*insert/s.test(source)));
});

test("界面含导入、手动收入、热力图正负文本与教程", async () => {
  const source = await read("app/finance-dashboard.tsx");
  for (const token of ["账单只读导入", "添加收入", "日历图", "柱状图", "cash-positive", "cash-negative", "用于个人对账", "CSV UTF-8", "原始文件不保存"]) assert.ok(source.includes(token), token);
});
