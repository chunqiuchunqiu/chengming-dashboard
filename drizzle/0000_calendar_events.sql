CREATE TABLE IF NOT EXISTS `calendar_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL,
  `starts_at` text NOT NULL,
  `all_day` integer DEFAULT false NOT NULL,
  `category` text DEFAULT '个人' NOT NULL,
  `priority` text DEFAULT '中' NOT NULL,
  `location` text DEFAULT '' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `reminder_minutes` integer DEFAULT 30 NOT NULL,
  `completed` integer DEFAULT false NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_calendar_events_user_start` ON `calendar_events` (`user_id`,`starts_at`);
