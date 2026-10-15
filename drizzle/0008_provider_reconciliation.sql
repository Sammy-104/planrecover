CREATE TABLE `provider_reconciliation_attempts` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`processing_started` text,
	`last_attempt` text,
	`last_error` text,
	`completed` text,
	FOREIGN KEY (`operation_id`) REFERENCES `provider_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_reconciliation_attempts_nonnegative" CHECK("provider_reconciliation_attempts"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_provider_reconciliation_owner_attempt` ON `provider_reconciliation_attempts` (`owner`,`last_attempt`);