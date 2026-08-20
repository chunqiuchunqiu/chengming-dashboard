CREATE TABLE `finance_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`safe_file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`inserted_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`skipped_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_import_batches_user_created_idx` ON `finance_import_batches` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`dedupe_key` text NOT NULL,
	`import_batch_id` text,
	`occurred_at` text NOT NULL,
	`direction` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`counterparty` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`original_category` text DEFAULT '' NOT NULL,
	`normalized_category` text DEFAULT '待分类' NOT NULL,
	`category_override` integer DEFAULT false NOT NULL,
	`payment_method_masked` text DEFAULT '' NOT NULL,
	`transaction_status` text DEFAULT '' NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`excluded_reason` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_transactions_user_occurred_idx` ON `finance_transactions` (`user_id`,`occurred_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_user_source_dedupe_unique` ON `finance_transactions` (`user_id`,`source`,`dedupe_key`);
