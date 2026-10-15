CREATE TABLE `background_job_runs` (
	`owner` text PRIMARY KEY NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`last_started` text,
	`last_completed` text,
	`last_result` text,
	`status` text DEFAULT 'idle' NOT NULL
);
