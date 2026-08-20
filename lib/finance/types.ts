export const FINANCE_SOURCES = ["wechat", "alipay"] as const;
export const TRANSACTION_SOURCES = ["wechat", "alipay", "manual"] as const;
export const DIRECTIONS = ["expense", "income", "refund", "transfer", "excluded"] as const;
export const NORMALIZED_CATEGORIES = [
  "餐饮", "交通", "居住", "日用购物", "数码家电", "医疗健康", "教育学习", "娱乐", "转账红包", "其他", "待分类",
] as const;
export const INCOME_CATEGORIES = ["工资", "奖金", "副业", "报销", "投资收益", "转账收入", "其他"] as const;

export type FinanceSource = typeof FINANCE_SOURCES[number];
export type TransactionSource = typeof TRANSACTION_SOURCES[number];
export type Direction = typeof DIRECTIONS[number];
export type NormalizedCategory = typeof NORMALIZED_CATEGORIES[number];
export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export type ParsedTransaction = {
  source: FinanceSource;
  externalId: string | null;
  dedupeKey: string;
  occurredAt: string;
  direction: Direction;
  amountFen: number;
  currency: "CNY";
  counterparty: string;
  description: string;
  originalCategory: string;
  normalizedCategory: NormalizedCategory;
  categoryOverride: false;
  paymentMethodMasked: string;
  transactionStatus: string;
  excluded: boolean;
  excludedReason: string;
  notes: string;
};

export type ParseIssue = { row: number; reason: string };
export type ParsedBill = {
  source: FinanceSource;
  encoding: "UTF-8" | "UTF-8 BOM" | "GB18030/GBK";
  detectedHeaders: string[];
  transactions: ParsedTransaction[];
  totalRows: number;
  skippedRows: number;
  errors: ParseIssue[];
  periodStart: string;
  periodEnd: string;
  fileHash: string;
};
