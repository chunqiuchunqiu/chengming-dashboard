import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAmountFen, parseShanghaiDate } from "../lib/finance/parser-core";
import { parseAlipayBill } from "../lib/finance/parsers/alipay";
import { parseWechatBill } from "../lib/finance/parsers/wechat";
import { FinanceHttpError, requireUserId, safeFileName, validateBillFile } from "../lib/finance/security";
import { monthBounds, summarizeRows } from "../lib/finance/stats";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const bytes = async (name: string) => new Uint8Array(await readFile(fixture(name)));

test("微信常见 CSV 表头、顶部说明和底部汇总可解析", async () => {
  const result = await parseWechatBill(await bytes("wechat-common.csv"));
  assert.equal(result.source, "wechat");
  assert.equal(result.transactions.length, 8);
  assert.ok(result.skippedRows >= 1);
  assert.equal(result.periodStart.slice(0, 10), "2026-08-01");
});

test("支付宝常见 CSV 表头可解析并标记余额明细", async () => {
  const result = await parseAlipayBill(await bytes("alipay-common.csv"));
  assert.equal(result.source, "alipay");
  assert.equal(result.transactions.length, 4);
  assert.equal(result.transactions[0].normalizedCategory, "交通");
});

test("UTF-8 BOM 自动识别", async () => {
  const original = await bytes("alipay-common.csv");
  const withBom = new Uint8Array(original.length + 3); withBom.set([0xef, 0xbb, 0xbf]); withBom.set(original, 3);
  const result = await parseAlipayBill(withBom);
  assert.equal(result.encoding, "UTF-8 BOM");
});

test("GB18030/GBK 自动回退", async () => {
  const encoded = Uint8Array.from([206,162,208,197,214,167,184,182,213,202,181,165,195,247,207,184,10,189,187,210,215,202,177,188,228,44,189,187,210,215,192,224,208,205,44,189,187,210,215,182,212,183,189,44,201,204,198,183,44,202,213,47,214,167,44,189,240,182,238,40,212,170,41,44,214,167,184,182,183,189,202,189,44,181,177,199,176,215,180,204,172,44,189,187,210,215,181,165,186,197,10,50,48,50,54,45,48,56,45,48,49,32,48,56,58,51,48,58,48,48,44,178,205,210,251,44,178,226,202,212,191,167,183,167,181,234,44,212,231,178,205,44,214,167,179,246,44,49,46,48,48,44,193,227,199,174,44,214,167,184,182,179,201,185,166,44,71,66,45,84,69,83,84,45,48,48,48,49,10]);
  const result = await parseWechatBill(encoded);
  assert.equal(result.encoding, "GB18030/GBK");
  assert.equal(result.transactions[0].amountFen, 100);
});

test("金额支持人民币符号、千分位、负号且保存整数分", () => {
  assert.equal(parseAmountFen("¥1,234.56"), 123456);
  assert.equal(parseAmountFen("-12.3"), 1230);
  assert.throws(() => parseAmountFen("0"));
  assert.throws(() => parseAmountFen("1.234"));
});

test("支出、退款、红包、转账、充值、提现和还款方向确定", async () => {
  const rows = (await parseWechatBill(await bytes("wechat-common.csv"))).transactions;
  assert.equal(rows[0].direction, "expense");
  assert.equal(rows[1].direction, "refund");
  assert.equal(rows[2].direction, "transfer");
  assert.equal(rows[2].normalizedCategory, "转账红包");
  assert.deepEqual(rows.slice(3, 6).map(item => item.direction), ["excluded", "excluded", "excluded"]);
  assert.equal(rows[6].direction, "transfer");
});

test("未知状态默认排除、未知分类进入待分类", async () => {
  const rows = (await parseWechatBill(await bytes("wechat-common.csv"))).transactions;
  assert.equal(rows[7].direction, "excluded");
  assert.equal(rows[7].normalizedCategory, "待分类");
  assert.equal(rows[7].excluded, true);
});

test("官方交易单号生成稳定去重键", async () => {
  const first = await parseWechatBill(await bytes("wechat-common.csv"));
  const second = await parseWechatBill(await bytes("wechat-common.csv"));
  assert.equal(first.transactions[0].dedupeKey, second.transactions[0].dedupeKey);
  assert.equal(new Set(first.transactions.map(item => item.dedupeKey)).size, first.transactions.length);
});

test("相同流水跨文件仍生成相同去重键", async () => {
  const original = await bytes("wechat-common.csv");
  const extended = new Uint8Array([...original, ...new TextEncoder().encode("\n")]);
  const first = await parseWechatBill(original); const second = await parseWechatBill(extended);
  assert.equal(first.transactions[0].dedupeKey, second.transactions[0].dedupeKey);
  assert.notEqual(first.fileHash, second.fileHash);
});

test("用户选择平台与文件不一致时拒绝", async () => {
  await assert.rejects(async () => parseAlipayBill(await bytes("wechat-common.csv")), /所选平台与文件不一致|无法识别/);
});

test("HTML、脚本和二进制伪装文件被拒绝", async () => {
  await assert.rejects(() => parseWechatBill(new TextEncoder().encode("<html><script>alert(1)</script></html>")), /HTML|脚本/);
  await assert.rejects(() => parseWechatBill(Uint8Array.from([0, 1, 2, 3, 4])), /二进制|编码/);
});

test("公式单元格被拒绝且错误不会静默写入", async () => {
  const text = "微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态,交易单号\n2026-08-01 08:00:00,餐饮,示例,=CMD(),支出,1.00,支付成功,FORMULA-1\n";
  await assert.rejects(() => parseWechatBill(new TextEncoder().encode(text)), /没有可导入明细/);
});

test("超大文件限制与扩展名伪造检查", () => {
  const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "bill.csv", { type: "text/csv" });
  assert.throws(() => validateBillFile(large), (error: unknown) => error instanceof FinanceHttpError && error.status === 413);
  assert.throws(() => validateBillFile(new File(["x"], "bill.xlsx", { type: "application/vnd.ms-excel" })), /CSV|TXT/);
});

test("月份边界固定为 Asia/Shanghai", () => {
  assert.deepEqual(monthBounds("2026-08"), { start: "2026-08-01T00:00:00+08:00", end: "2026-09-01T00:00:00+08:00" });
  assert.deepEqual(monthBounds("2026-12"), { start: "2026-12-01T00:00:00+08:00", end: "2027-01-01T00:00:00+08:00" });
  assert.equal(parseShanghaiDate("2026-08-31 23:59:59"), "2026-08-31T23:59:59+08:00");
});

test("只有手动收入计入收入；导入收入不计入", () => {
  const result = summarizeRows([
    { source: "manual", direction: "income", amountFen: 100000, excluded: false, normalizedCategory: "其他", occurredAt: "2026-08-01T00:00:00+08:00" },
    { source: "alipay", direction: "income", amountFen: 200000, excluded: false, normalizedCategory: "待分类", occurredAt: "2026-08-01T01:00:00+08:00" },
  ]);
  assert.equal(result.manualIncomeFen, 100000);
  assert.equal(result.netCashflowFen, 100000);
});

test("退款按负支出，排除项不计消费", () => {
  const result = summarizeRows([
    { source: "wechat", direction: "expense", amountFen: 10000, excluded: false, normalizedCategory: "餐饮", occurredAt: "2026-08-01T00:00:00+08:00" },
    { source: "wechat", direction: "refund", amountFen: 3000, excluded: false, normalizedCategory: "餐饮", occurredAt: "2026-08-02T00:00:00+08:00" },
    { source: "wechat", direction: "excluded", amountFen: 99999, excluded: true, normalizedCategory: "待分类", occurredAt: "2026-08-03T00:00:00+08:00" },
  ]);
  assert.equal(result.netExpenseFen, 7000);
  assert.equal(result.daily.find(item => item.date === "2026-08-01")?.netCashflowFen, -10000);
  assert.equal(result.daily.find(item => item.date === "2026-08-02")?.netCashflowFen, 3000);
});

test("日历热力图输入同时保留正负号语义", () => {
  const result = summarizeRows([
    { source: "manual", direction: "income", amountFen: 5000, excluded: false, normalizedCategory: "其他", occurredAt: "2026-08-01T10:00:00+08:00" },
    { source: "alipay", direction: "expense", amountFen: 3000, excluded: false, normalizedCategory: "交通", occurredAt: "2026-08-02T10:00:00+08:00" },
  ]);
  assert.deepEqual(result.daily.map(item => item.netCashflowFen), [5000, -3000]);
});

test("未登录生产请求返回 401；开发回退必须显式开启", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV; const previousFlag = mutableEnv.ALLOW_LOCAL_DEV_USER;
  delete mutableEnv.ALLOW_LOCAL_DEV_USER;
  mutableEnv.NODE_ENV = "production";
  assert.throws(() => requireUserId(new Request("https://example.com/api/finance/summary")), (error: unknown) => error instanceof FinanceHttpError && error.status === 401);
  mutableEnv.NODE_ENV = "development"; mutableEnv.ALLOW_LOCAL_DEV_USER = "true";
  assert.equal(requireUserId(new Request("http://localhost/api/finance/summary")), "local-development-user");
  if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = previousNodeEnv;
  if (previousFlag === undefined) delete mutableEnv.ALLOW_LOCAL_DEV_USER; else mutableEnv.ALLOW_LOCAL_DEV_USER = previousFlag;
});

test("安全文件名移除路径和特殊字符", () => {
  assert.equal(safeFileName("../私人 账单.csv"), "私人_账单.csv");
});
