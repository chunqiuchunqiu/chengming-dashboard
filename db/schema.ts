import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
