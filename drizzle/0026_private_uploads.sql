CREATE TABLE `private_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`purpose` text NOT NULL,
	`file_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`result` text,
	CONSTRAINT "private_uploads_purpose_valid" CHECK("private_uploads"."purpose" IN ('document','receipt')),
	CONSTRAINT "private_uploads_mime_valid" CHECK("private_uploads"."mime" IN ('application/pdf','image/png','image/jpeg','image/webp')),
	CONSTRAINT "private_uploads_size_valid" CHECK("private_uploads"."size">0 AND "private_uploads"."size"<=8388608),
	CONSTRAINT "private_uploads_hash_valid" CHECK(length("private_uploads"."sha256")=64),
	CONSTRAINT "private_uploads_status_valid" CHECK("private_uploads"."status" IN ('pending','processing','used','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_uploads_file_key_unique` ON `private_uploads` (`file_key`);--> statement-breakpoint
CREATE INDEX `private_uploads_retention` ON `private_uploads` (`owner`,`deleted_at`,`expires`,`lease_until`);--> statement-breakpoint
CREATE INDEX `private_uploads_member` ON `private_uploads` (`owner`,`plan_id`,`member_id`,`created`);