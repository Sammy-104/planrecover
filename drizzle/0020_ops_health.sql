CREATE TABLE `background_run_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "background_evidence_source" CHECK("background_run_evidence"."source" IN ('manual','scheduled')),
	CONSTRAINT "background_evidence_status" CHECK("background_run_evidence"."status" IN ('running','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX `background_evidence_scope` ON `background_run_evidence` (`owner`,`source`,`started_at`);--> statement-breakpoint
CREATE TABLE `ops_health_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`code` text NOT NULL,
	`generation` integer NOT NULL,
	`event` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`configuration_hash` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`accepted_at` text,
	`last_outcome` text,
	CONSTRAINT "ops_alert_event" CHECK("ops_health_alerts"."event" IN ('opened','recovered')),
	CONSTRAINT "ops_alert_status" CHECK("ops_health_alerts"."status" IN ('pending','sending','accepted','rejected','uncertain','cancelled')),
	CONSTRAINT "ops_alert_attempts" CHECK("ops_health_alerts"."attempts">=0 AND "ops_health_alerts"."generation">=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_health_alert_episode` ON `ops_health_alerts` (`owner`,`code`,`generation`,`event`);--> statement-breakpoint
CREATE INDEX `ops_health_alert_due` ON `ops_health_alerts` (`owner`,`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `ops_health_episodes` (
	`owner` text NOT NULL,
	`code` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`active` integer NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `code`),
	CONSTRAINT "ops_episode_generation" CHECK("ops_health_episodes"."generation">=1),
	CONSTRAINT "ops_episode_active" CHECK("ops_health_episodes"."active" IN (0,1))
);
