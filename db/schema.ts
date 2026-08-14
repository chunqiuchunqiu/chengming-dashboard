import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
