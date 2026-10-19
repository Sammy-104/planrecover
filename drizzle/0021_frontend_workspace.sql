CREATE TABLE `document_objects` (
	`file_key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL,
	`source_sha256` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_status" CHECK("document_objects"."status" IN ('staged','ready','deleting','deleted')),
	CONSTRAINT "document_hash" CHECK(length("document_objects"."source_sha256")=64),
	CONSTRAINT "document_size" CHECK("document_objects"."size">0 AND "document_objects"."size"<=8388608)
);
--> statement-breakpoint
CREATE INDEX `idx_document_objects_cleanup` ON `document_objects` (`owner`,`status`,`created`,`lease_until`);--> statement-breakpoint
CREATE TABLE `idea_collections` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	CONSTRAINT "ideas_json" CHECK(json_valid("idea_collections"."body")),
	CONSTRAINT "ideas_version" CHECK("idea_collections"."version">=0)
);
--> statement-breakpoint
CREATE TABLE `plan_presence` (
	`owner` text NOT NULL,
	`trip_id` text NOT NULL,
	`member_id` text NOT NULL,
	`session_id` text NOT NULL,
	`view` text NOT NULL,
	`status` text NOT NULL,
	`item_id` text,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `trip_id`, `member_id`),
	FOREIGN KEY (`owner`,`trip_id`,`member_id`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "presence_status" CHECK("plan_presence"."status" IN ('viewing','editing')),
	CONSTRAINT "presence_seen" CHECK("plan_presence"."seen_at">=0)
);
--> statement-breakpoint
CREATE INDEX `idx_plan_presence_trip` ON `plan_presence` (`owner`,`trip_id`,`seen_at`);--> statement-breakpoint
CREATE TABLE `trip_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`trip_id` text NOT NULL,
	`uploader` text NOT NULL,
	`body` text NOT NULL,
	`file_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`size` integer NOT NULL,
	`source_sha256` text NOT NULL,
	FOREIGN KEY (`owner`,`trip_id`,`uploader`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_key`) REFERENCES `document_objects`(`file_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trip_doc_json" CHECK(json_valid("trip_documents"."body")),
	CONSTRAINT "trip_doc_version" CHECK("trip_documents"."version">=1),
	CONSTRAINT "trip_doc_size" CHECK("trip_documents"."size">0 AND "trip_documents"."size"<=8388608),
	CONSTRAINT "trip_doc_hash" CHECK(length("trip_documents"."source_sha256")=64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_documents_file_key_unique` ON `trip_documents` (`file_key`);--> statement-breakpoint
CREATE INDEX `idx_documents_owner_trip` ON `trip_documents` (`owner`,`trip_id`);