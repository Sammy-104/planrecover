CREATE TABLE `backend_write_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "backend_write_guard_valid" CHECK("backend_write_guards"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE `member_preferences` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `member_id`),
	FOREIGN KEY (`owner`,`plan_id`,`member_id`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "preferences_version_nonnegative" CHECK("member_preferences"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `plan_members` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `member_id`),
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_members_role_valid" CHECK("plan_members"."role" IN ('owner','editor','viewer','legacy'))
);
--> statement-breakpoint
CREATE INDEX `plan_members_identity` ON `plan_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`),
	CONSTRAINT "plans_version_nonnegative" CHECK("plans"."version" >= 0),
	CONSTRAINT "plans_status_valid" CHECK("plans"."status" IN ('active','archived','deleted'))
);
--> statement-breakpoint
CREATE INDEX `plans_owner_status` ON `plans` (`owner`,`status`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`updated` text NOT NULL
);
