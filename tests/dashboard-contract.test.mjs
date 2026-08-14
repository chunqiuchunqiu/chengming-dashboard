import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("dashboard keeps simulation and research disclaimers visible", async () => {
  const page = await read("app/dashboard.tsx");
  assert.match(page, /模拟数据/);
  assert.match(page, /不构成个性化投资建议/);
  assert.match(page, /没有任何自动交易或证券账户权限/);
  assert.match(page, /转账、支付、交易、下单、撤单/);
});

test("credentials stay server-side placeholders", async () => {
  const env = await read(".env.example");
  assert.match(env, /BANK_READONLY_CLIENT_SECRET=/);
  assert.doesNotMatch(env, /=\S{8,}/);
  const client = await read("app/dashboard.tsx");
  assert.doesNotMatch(client, /API_KEY\s*=|CLIENT_SECRET\s*=/);
});

test("calendar persistence is user-scoped", async () => {
  const route = await read("app/api/events/route.ts");
  assert.match(route, /oai-authenticated-user-id/);
  assert.match(route, /eq\(calendarEvents\.userId, userId\(request\)\)/);
  assert.match(route, /title.*slice\(0, 120\)/s);
});

test("weekly A-share reports use authenticated server-side ingestion", async () => {
  const workflow = await read(".github/workflows/weekly-a-share-report.yml");
  const ingest = await read("app/api/admin/stock-reports/route.ts");
  const latest = await read("app/api/stock-reports/latest/route.ts");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /secrets\.DEEPSEEK_API_KEY/);
  assert.match(workflow, /secrets\.REPORT_INGEST_SECRET/);
  assert.match(workflow, /secrets\.SITES_BYPASS_TOKEN/);
  assert.match(ingest, /authorization/);
  assert.match(ingest, /REPORT_INGEST_SECRET/);
  assert.match(ingest, /onConflictDoUpdate/);
  assert.match(latest, /status, "success"/);
});

test("real stock mode reads persisted reports and has no trading path", async () => {
  const page = await read("app/dashboard.tsx");
  const generator = await read("scripts/generate_a_share_report.py");
  assert.match(page, /api\/stock-reports\/latest/);
  assert.match(page, /量价情绪代理/);
  assert.match(generator, /stock_zh_a_spot_em/);
  assert.match(generator, /stock_zh_a_hist/);
  assert.doesNotMatch(generator, /place_order|submit_order|cancel_order|trade_account/i);
});
