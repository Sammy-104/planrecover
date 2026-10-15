ALTER TABLE `webhook_events` ADD `status` text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `processing_started` text;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `processed` text;--> statement-breakpoint
CREATE INDEX `idx_provider_operations_provider_kind` ON `provider_operations` (`provider_id`,`kind`);