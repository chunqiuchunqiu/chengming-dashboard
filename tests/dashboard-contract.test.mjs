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
