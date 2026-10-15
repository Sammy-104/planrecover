ALTER TABLE `assistant_conversations` ADD `context_actor` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `metadata` text DEFAULT '{}' NOT NULL;