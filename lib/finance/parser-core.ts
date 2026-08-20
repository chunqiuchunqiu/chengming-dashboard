import { FinanceHttpError, assertRowLimit } from "./security";
import type { Direction, FinanceSource, NormalizedCategory, ParsedBill, ParsedTransaction } from "./types";

export type HeaderAliases = Record<string, readonly string[]>;
export type BillAdapter = {
  source: FinanceSource;
  platformWords: readonly string[];
  aliases: HeaderAliases;
};

const EXCLUDED_RULES: Array<[RegExp, string]> = [
  [/充值/, "充值不计入消费"], [/提现/, "提现不计入消费"], [/信用卡还款|还信用卡/, "信用卡还款不计入消费"],
  [/理财|基金|申购|赎回|证券|投资/, "投资交易不计入消费"], [/账户互转|余额宝转入|余额宝转出/, "账户互转不计入消费"],
];
const CATEGORY_RULES: Array<[NormalizedCategory, RegExp]> = [
  ["转账红包", /转账|红包|亲属卡/], ["餐饮", /餐饮|外卖|咖啡|奶茶|美团|饿了么|饭店|餐厅|食品/],
  ["交通", /交通|地铁|公交|打车|滴滴|铁路|航空|加油|停车|高速/], ["居住", /房租|物业|水费|电费|燃气|宽带|居住/],
  ["数码家电", /数码|家电|电脑|手机|电器/], ["医疗健康", /医疗|医院|药房|健康|体检/],
  ["教育学习", /教育|学习|课程|书店|培训/], ["娱乐", /娱乐|电影|游戏|会员|演出|旅游/],
  ["日用购物", /购物|超市|便利店|百货|淘宝|天猫|京东|拼多多|日用/],
];

export async function parseWithAdapter(bytes: Uint8Array, adapter: BillAdapter): Promise<ParsedBill> {
  const { text, encoding } = decodeText(bytes);
  rejectUnsafeText(text);
  const rows = parseDelimited(text);
  assertRowLimit(rows.length);
  const headerIndex = findHeaderRow(rows, adapter.aliases);
  if (headerIndex < 0) {
    const detected = rows.slice(0, 15).flat().filter(Boolean).slice(0, 18);
    throw new FinanceHttpError(400, `无法识别账单表头；检测到：${detected.join("、") || "无"}`);
  }
  const preamble = rows.slice(0, headerIndex).flat().join(" ");
  const headers = rows[headerIndex].map(cleanCell);
  const detectedSource = detectSource(`${preamble} ${headers.join(" ")}`);
  if (detectedSource && detectedSource !== adapter.source) {
    throw new FinanceHttpError(400, `所选平台与文件不一致：检测到${detectedSource === "wechat" ? "微信" : "支付宝"}账单`);
  }
  if (!detectedSource && !adapter.platformWords.some(word => `${preamble} ${headers.join(" ")}`.includes(word))) {
    throw new FinanceHttpError(400, `无法确认文件来自${adapter.source === "wechat" ? "微信" : "支付宝"}；检测到表头：${headers.join("、")}`);
  }
  const columns = resolveColumns(headers, adapter.aliases);
  const transactions: ParsedTransaction[] = [];
  const errors: Array<{ row: number; reason: string }> = [];
  let skippedRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every(cell => !cleanCell(cell)) || isFooter(row)) { skippedRows++; continue; }
    try {
      const transaction = await normalizeRow(adapter.source, row, columns);
      if (transaction) transactions.push(transaction); else skippedRows++;
    } catch (error) {
      errors.push({ row: index + 1, reason: error instanceof Error ? error.message.slice(0, 120) : "无法解析" });
    }
  }
  if (!transactions.length) throw new FinanceHttpError(400, `账单中没有可导入明细；检测到表头：${headers.join("、")}`);
  const dates = transactions.map(item => item.occurredAt).sort();
  return {
    source: adapter.source,
    encoding,
    detectedHeaders: headers,
    transactions,
    totalRows: rows.length - headerIndex - 1,
    skippedRows,
    errors,
    periodStart: dates[0],
    periodEnd: dates.at(-1)!,
    fileHash: await sha256(bytes),
  };
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: ParsedBill["encoding"] } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.slice(3) : bytes);
    return { text, encoding: bom ? "UTF-8 BOM" : "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("gb18030", { fatal: true }).decode(bytes), encoding: "GB18030/GBK" };
    } catch {
      throw new FinanceHttpError(400, "无法识别文件编码；请用 Excel/WPS 另存为 CSV UTF-8 后重试");
    }
  }
}

export function parseDelimited(text: string): string[][] {
  const delimiter = chooseDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function chooseDelimiter(text: string) {
  const sample = text.slice(0, 20_000);
  const comma = (sample.match(/,/g) || []).length;
  const tab = (sample.match(/\t/g) || []).length;
  return tab > comma ? "\t" : ",";
}

function rejectUnsafeText(text: string) {
  if (text.includes("\0")) throw new FinanceHttpError(415, "文件包含二进制内容，不是有效的文本账单");
  const prefix = text.slice(0, 5000).toLowerCase();
  if (/<\s*(html|script|iframe|!doctype)/i.test(prefix)) throw new FinanceHttpError(415, "拒绝 HTML 或脚本伪装文件");
  const controlCount = [...prefix].filter(char => char.charCodeAt(0) < 9 || (char.charCodeAt(0) > 13 && char.charCodeAt(0) < 32)).length;
  if (controlCount > Math.max(5, prefix.length * 0.01)) throw new FinanceHttpError(415, "文件包含异常二进制控制字符");
}

function cleanCell(value: string) { return value.replace(/^\uFEFF/, "").replace(/^['"]|['"]$/g, "").trim(); }
function normalizeHeader(value: string) { return cleanCell(value).replace(/[\s（）()：:]/g, "").toLowerCase(); }

function findHeaderRow(rows: string[][], aliases: HeaderAliases) {
  const known = new Set(Object.values(aliases).flat().map(normalizeHeader));
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const hits = rows[i].map(normalizeHeader).filter(value => known.has(value)).length;
    if (hits >= 3) return i;
  }
  return -1;
}

function resolveColumns(headers: string[], aliases: HeaderAliases) {
  const normalized = headers.map(normalizeHeader);
  const result: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    result[field] = normalized.findIndex(header => names.map(normalizeHeader).includes(header));
  }
  for (const required of ["occurredAt", "amount", "direction"]) {
    if (result[required] < 0) throw new FinanceHttpError(400, `缺少必要表头 ${required}；检测到：${headers.join("、")}`);
  }
  return result;
}

function detectSource(text: string): FinanceSource | null {
  if (/微信支付|微信账单|微信支付账单明细/.test(text) || /交易类型.*交易对方.*商品.*收\/支/.test(text)) return "wechat";
  if (/支付宝|alipay|余额收支明细/i.test(text) || /交易号.*商家订单号.*交易创建时间/.test(text)) return "alipay";
  return null;
}

function get(row: string[], columns: Record<string, number>, key: string) {
  const index = columns[key];
  return index >= 0 ? cleanCell(row[index] || "") : "";
}

async function normalizeRow(source: FinanceSource, row: string[], columns: Record<string, number>): Promise<ParsedTransaction | null> {
  const occurredAt = parseShanghaiDate(get(row, columns, "occurredAt"));
  const rawAmount = get(row, columns, "amount");
  if (!occurredAt && !rawAmount) return null;
  if (!occurredAt) throw new Error("交易时间无效");
  for (const cell of row) if (/^[=@+]/.test(cleanCell(cell)) || /^-[A-Za-z_]/.test(cleanCell(cell))) throw new Error("拒绝公式单元格");
  const amountFen = parseAmountFen(rawAmount);
  const rawDirection = get(row, columns, "direction");
  const status = get(row, columns, "status");
  const originalCategory = get(row, columns, "category");
  const counterparty = get(row, columns, "counterparty").slice(0, 200);
  const description = get(row, columns, "description").slice(0, 300);
  const combined = `${rawDirection} ${status} ${originalCategory} ${counterparty} ${description}`;
  const classification = classifyDirection(combined, rawDirection, status);
  const externalId = get(row, columns, "externalId").replace(/\s/g, "").slice(0, 128) || null;
  const dedupeMaterial = externalId
    ? `${source}|external|${externalId}`
    : `${source}|${occurredAt}|${amountFen}|${classification.direction}|${counterparty}|${description}`;
  return {
    source,
    externalId,
    dedupeKey: await sha256(new TextEncoder().encode(dedupeMaterial)),
    occurredAt,
    direction: classification.direction,
    amountFen,
    currency: "CNY",
    counterparty,
    description,
    originalCategory: originalCategory.slice(0, 100),
    normalizedCategory: normalizeCategory(combined, classification.direction),
    categoryOverride: false,
    paymentMethodMasked: maskPaymentMethod(get(row, columns, "paymentMethod")),
    transactionStatus: status.slice(0, 100),
    excluded: classification.excluded,
    excludedReason: classification.reason,
    notes: "",
  };
}

export function parseAmountFen(input: string) {
  const clean = input.replace(/[¥￥,，\s]/g, "");
  const match = clean.match(/^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("金额格式无效");
  const fen = Number(match[2]) * 100 + Number((match[3] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(fen) || fen <= 0) throw new Error("金额必须大于 0");
  return fen;
}

export function parseShanghaiDate(input: string) {
  const match = input.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return "";
  const [, y, m, d, h = "0", min = "0", sec = "0"] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(sec)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d) || Number(h) > 23) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${min}:${sec}+08:00`;
}

function classifyDirection(combined: string, rawDirection: string, status: string): { direction: Direction; excluded: boolean; reason: string } {
  if (/交易关闭|已关闭|失败|未支付|已撤销/.test(status)) return { direction: "excluded", excluded: true, reason: "未成功交易" };
  if (/退款|退回/.test(combined)) return { direction: "refund", excluded: false, reason: "" };
  for (const [pattern, reason] of EXCLUDED_RULES) if (pattern.test(combined)) return { direction: "excluded", excluded: true, reason };
  if (/不计收支|资金不计入/.test(rawDirection)) return { direction: "excluded", excluded: true, reason: "平台标记不计收支" };
  if (/收入|收款/.test(rawDirection)) return { direction: "income", excluded: false, reason: "导入收入不计入手动收入统计" };
  if (/转账|红包/.test(combined)) return { direction: "transfer", excluded: false, reason: "" };
  if (/支出|付款/.test(rawDirection)) return { direction: "expense", excluded: false, reason: "" };
  return { direction: "excluded", excluded: true, reason: "未知收支状态" };
}

function normalizeCategory(combined: string, direction: Direction): NormalizedCategory {
  if (direction === "transfer") return "转账红包";
  if (direction === "excluded" || direction === "income") return "待分类";
  for (const [category, rule] of CATEGORY_RULES) if (rule.test(combined)) return category;
  return direction === "refund" ? "其他" : "待分类";
}

function maskPaymentMethod(value: string) {
  const clean = value.slice(0, 80);
  const digits = clean.match(/\d/g)?.join("") || "";
  if (digits.length >= 4) return `${clean.replace(/\d/g, "*").replace(/\*+$/, "")}****${digits.slice(-4)}`.slice(0, 80);
  return clean.replace(/\d/g, "*");
}

function isFooter(row: string[]) {
  const text = row.map(cleanCell).join(" ");
  return /^(共|合计|总计|导出时间|记录数)|以上为/.test(text);
}

export async function sha256(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function maskedPreview(item: ParsedTransaction) {
  const party = item.counterparty ? `${item.counterparty.slice(0, 1)}${"*".repeat(Math.min(3, Math.max(1, item.counterparty.length - 1)))}` : "未提供";
  return { occurredAt: item.occurredAt, direction: item.direction, amountFen: item.amountFen, counterparty: party, description: item.description.slice(0, 16), normalizedCategory: item.normalizedCategory, excluded: item.excluded };
}
