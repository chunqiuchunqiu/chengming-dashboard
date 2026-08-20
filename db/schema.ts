import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  category: text("category").notNull().default("个人"),
  priority: text("priority").notNull().default("中"),
  location: text("location").notNull().default(""),
  notes: text("notes").notNull().default(""),
  reminderMinutes: integer("reminder_minutes").notNull().default(30),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const stockReports = sqliteTable("stock_reports", {
  id: text("id").primaryKey(),
  isoYearWeek: text("iso_year_week").notNull(),
  market: text("market").notNull().default("A股"),
  status: text("status").notNull().default("success"),
  dataAsOf: text("data_as_of").notNull(),
  generatedAt: text("generated_at").notNull(),
  dataProvider: text("data_provider").notNull(),
  summaryProvider: text("summary_provider").notNull(),
  reportJson: text("report_json").notNull(),
  errorMessage: text("error_message").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("stock_reports_iso_year_week_unique").on(table.isoYearWeek),
]);

export const financeImportBatches = sqliteTable("finance_import_batches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  source: text("source", { enum: ["wechat", "alipay"] }).notNull(),
  safeFileName: text("safe_file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  insertedRows: integer("inserted_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("finance_import_batches_user_created_idx").on(table.userId, table.createdAt),
]);

export const financeTransactions = sqliteTable("finance_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  source: text("source", { enum: ["wechat", "alipay", "manual"] }).notNull(),
  externalId: text("external_id"),
  dedupeKey: text("dedupe_key").notNull(),
  importBatchId: text("import_batch_id"),
  occurredAt: text("occurred_at").notNull(),
  direction: text("direction", { enum: ["expense", "income", "refund", "transfer", "excluded"] }).notNull(),
  amountFen: integer("amount_fen").notNull(),
  currency: text("currency").notNull().default("CNY"),
  counterparty: text("counterparty").notNull().default(""),
  description: text("description").notNull().default(""),
  originalCategory: text("original_category").notNull().default(""),
  normalizedCategory: text("normalized_category").notNull().default("待分类"),
  categoryOverride: integer("category_override", { mode: "boolean" }).notNull().default(false),
  paymentMethodMasked: text("payment_method_masked").notNull().default(""),
  transactionStatus: text("transaction_status").notNull().default(""),
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  excludedReason: text("excluded_reason").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("finance_transactions_user_occurred_idx").on(table.userId, table.occurredAt),
  uniqueIndex("finance_transactions_user_source_dedupe_unique").on(table.userId, table.source, table.dedupeKey),
]);
