CREATE TABLE `adapter_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`request` text NOT NULL,
	`response` text,
	`status` text DEFAULT 'prepared' NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `adapter_operations_scope` ON `adapter_operations` (`owner`,`plan_id`,`created`);--> statement-breakpoint
CREATE TABLE `agent_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`member_id` text NOT NULL,
	`plan_id` text,
	`body` text NOT NULL,
	`plan_version` integer NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`result` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_proposals_member` ON `agent_proposals` (`owner`,`member_id`,`created`);--> statement-breakpoint
CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`member_id` text NOT NULL,
	`plan_id` text,
	`title` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_member` ON `assistant_conversations` (`owner`,`member_id`,`updated`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`mode` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_messages_request_role` ON `assistant_messages` (`conversation_id`,`request_id`,`role`);--> statement-breakpoint
CREATE INDEX `assistant_messages_history` ON `assistant_messages` (`conversation_id`,`created`,`id`);--> statement-breakpoint
CREATE TABLE `notification_destinations` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`channel` text NOT NULL,
	`destination` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`confirmed_at` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `member_id`, `channel`)
);
--> statement-breakpoint
CREATE TABLE `plan_change_approvals` (
	`change_id` text NOT NULL,
	`member_id` text NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`change_id`, `member_id`),
	FOREIGN KEY (`change_id`) REFERENCES `plan_changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`created` text NOT NULL,
	`created_by` text NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_changes_scope` ON `plan_changes` (`owner`,`plan_id`,`created`);--> statement-breakpoint
CREATE TABLE `receipt_objects` (
	`file_key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`created` text NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `receipt_objects_cleanup` ON `receipt_objects` (`status`,`created`,`lease_until`);--> statement-breakpoint
CREATE TABLE `receipt_revisions` (
	`draft_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`draft_id`, `version`)
);
--> statement-breakpoint
CREATE TRIGGER plan_change_terms_immutable BEFORE UPDATE OF owner,plan_id,body,created_by,created ON plan_changes BEGIN SELECT RAISE(ABORT,'plan change terms are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER plan_change_approvals_immutable BEFORE UPDATE ON plan_change_approvals BEGIN SELECT RAISE(ABORT,'plan change approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER plan_change_approvals_retained BEFORE DELETE ON plan_change_approvals BEGIN SELECT RAISE(ABORT,'plan change approvals are retained'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_revision_insert AFTER INSERT ON receipt_drafts BEGIN INSERT INTO receipt_revisions(draft_id,version,body,created) VALUES(NEW.id,NEW.version,json_object('status',NEW.status,'sourceFacts',json(NEW.source_facts),'warnings',json(NEW.warnings),'reviewedReceipt',json(NEW.reviewed_receipt),'provider',NEW.provider,'modelId',NEW.model_id),NEW.updated); END;
--> statement-breakpoint
CREATE TRIGGER receipt_revision_update AFTER UPDATE ON receipt_drafts WHEN NEW.version<>OLD.version BEGIN INSERT INTO receipt_revisions(draft_id,version,body,created) VALUES(NEW.id,NEW.version,json_object('status',NEW.status,'sourceFacts',json(NEW.source_facts),'warnings',json(NEW.warnings),'reviewedReceipt',json(NEW.reviewed_receipt),'provider',NEW.provider,'modelId',NEW.model_id),NEW.updated); END;
--> statement-breakpoint
CREATE TRIGGER receipt_revisions_immutable BEFORE UPDATE ON receipt_revisions BEGIN SELECT RAISE(ABORT,'receipt revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_revisions_retained BEFORE DELETE ON receipt_revisions BEGIN SELECT RAISE(ABORT,'receipt revisions are retained'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_review_live_object BEFORE UPDATE ON receipt_drafts WHEN NEW.status='reviewed' AND EXISTS(SELECT 1 FROM receipt_objects WHERE file_key=NEW.file_key AND status IN ('deleting','deleted')) BEGIN SELECT RAISE(ABORT,'receipt source is retired'); END;
