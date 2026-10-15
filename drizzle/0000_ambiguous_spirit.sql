CREATE TABLE `provider_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`item_id` text NOT NULL,
	`member` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`payload` text
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`received` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
