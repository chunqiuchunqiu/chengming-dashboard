CREATE TABLE IF NOT EXISTS `stock_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `iso_year_week` text NOT NULL,
  `market` text DEFAULT 'A股' NOT NULL,
  `status` text DEFAULT 'success' NOT NULL,
  `data_as_of` text NOT NULL,
  `generated_at` text NOT NULL,
  `data_provider` text NOT NULL,
  `summary_provider` text NOT NULL,
  `report_json` text NOT NULL,
  `error_message` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `stock_reports_iso_year_week_unique` ON `stock_reports` (`iso_year_week`);
