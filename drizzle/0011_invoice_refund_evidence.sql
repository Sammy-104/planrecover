CREATE TABLE `capture_refund_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `capture_refund_capacity`(`capture_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capture_refund_claim_amount_valid" CHECK("capture_refund_claims"."amount" > 0),
	CONSTRAINT "capture_refund_claim_status_valid" CHECK("capture_refund_claims"."status" IN ('reserved','confirmed'))
);
--> statement-breakpoint
CREATE INDEX `capture_refund_claims_capture` ON `capture_refund_claims` (`capture_id`);--> statement-breakpoint
ALTER TABLE `plan_invoices` ADD `provider_url` text;