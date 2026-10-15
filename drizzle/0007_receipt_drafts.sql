CREATE TABLE `receipt_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`file_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`source_facts` text,
	`unknown_fields` text NOT NULL,
	`warnings` text NOT NULL,
	`reviewed_receipt` text,
	`provider` text,
	`model_id` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipt_drafts_status_valid" CHECK("receipt_drafts"."status" IN ('uploaded','extracting','review-required','failed','reviewed')),
	CONSTRAINT "receipt_drafts_version_valid" CHECK("receipt_drafts"."version" >= 0),
	CONSTRAINT "receipt_drafts_size_valid" CHECK("receipt_drafts"."size" > 0 AND "receipt_drafts"."size" <= 8388608)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_drafts_file_key_unique` ON `receipt_drafts` (`file_key`);--> statement-breakpoint
CREATE INDEX `receipt_drafts_plan_updated` ON `receipt_drafts` (`owner`,`plan_id`,`updated`);