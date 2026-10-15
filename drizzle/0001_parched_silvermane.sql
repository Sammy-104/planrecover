CREATE TABLE `trip_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`owner` text NOT NULL,
	`trip_id` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trip_links_owner_trip` ON `trip_links` (`owner`,`trip_id`);