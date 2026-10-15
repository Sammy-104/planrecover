CREATE TABLE `planning_evidence` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`body` text NOT NULL,
	`subject_snapshot` text NOT NULL,
	`source_url` text NOT NULL,
	`checked_at` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `kind`, `subject_key`),
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "planning_evidence_kind_valid" CHECK("planning_evidence"."kind" IN ('supplier','travel')),
	CONSTRAINT "planning_evidence_version_valid" CHECK("planning_evidence"."version">0),
	CONSTRAINT "planning_evidence_status_valid" CHECK("planning_evidence"."status" IN ('active','revoked'))
);
--> statement-breakpoint
CREATE INDEX `planning_evidence_plan` ON `planning_evidence` (`owner`,`plan_id`,`kind`);--> statement-breakpoint
ALTER TABLE `background_job_runs` ADD `reminder_cursor` text;