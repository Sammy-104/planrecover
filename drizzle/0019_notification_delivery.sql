CREATE TABLE `notification_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`digest` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `adapter_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_event_type_valid" CHECK("notification_delivery_events"."event_type" IN ('delivery','bounce','complaint','delay','rejected'))
);
--> statement-breakpoint
CREATE INDEX `notification_delivery_events_scope` ON `notification_delivery_events` (`owner`,`plan_id`,`member_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `notification_delivery_events_attempt` ON `notification_delivery_events` (`attempt_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `notification_suppressions` (
	`owner` text NOT NULL,
	`destination_hash` text NOT NULL,
	`reason` text NOT NULL,
	`suppressed_until` integer,
	`event_id` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `destination_hash`),
	FOREIGN KEY (`event_id`) REFERENCES `notification_delivery_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_suppression_reason_valid" CHECK("notification_suppressions"."reason" IN ('hard-bounce','soft-bounce','complaint'))
);
--> statement-breakpoint
CREATE TABLE `web_push_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`subscription_version` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `reminder_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `web_push_subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "web_push_attempt_status_valid" CHECK("web_push_attempts"."status" IN ('sending','accepted','rejected','expired','uncertain','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_push_attempts_job_subscription` ON `web_push_attempts` (`job_id`,`subscription_id`);--> statement-breakpoint
CREATE TABLE `web_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`subscription` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`owner`,`plan_id`,`member_id`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "web_push_subscription_version_valid" CHECK("web_push_subscriptions"."version">=1),
	CONSTRAINT "web_push_subscription_status_valid" CHECK("web_push_subscriptions"."status" IN ('active','revoked','expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_push_subscriptions_endpoint_hash_unique` ON `web_push_subscriptions` (`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `web_push_subscriptions_member` ON `web_push_subscriptions` (`owner`,`plan_id`,`member_id`,`status`);