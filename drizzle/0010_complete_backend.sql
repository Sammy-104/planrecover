CREATE TABLE `approval_members` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`member_id` text NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `item_id`, `revision`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `approval_revisions` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `item_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `financial_event_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`event_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`recorded` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_event_transition_unique` ON `financial_event_history` (`owner`,`plan_id`,`event_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `financial_event_history_plan` ON `financial_event_history` (`owner`,`plan_id`,`recorded`);--> statement-breakpoint
CREATE TABLE `financial_events` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`event_id` text NOT NULL,
	`facts` text NOT NULL,
	`body` text NOT NULL,
	`currency` text NOT NULL,
	`provider` text,
	`provider_id` text,
	`kind` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `event_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_provider_effect_unique` ON `financial_events` (`provider`,`provider_id`,`kind`);--> statement-breakpoint
CREATE TABLE `payment_funding_claims` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`member_id` text NOT NULL,
	`channel` text NOT NULL,
	`reference_id` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `item_id`, `revision`, `member_id`),
	CONSTRAINT "payment_funding_channel_valid" CHECK("payment_funding_claims"."channel" IN ('order','invoice'))
);
--> statement-breakpoint
CREATE TABLE `provider_request_intents` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`path` text NOT NULL,
	`method` text NOT NULL,
	`request_body` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created` text NOT NULL,
	`replay_before` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_intents_owner` ON `provider_request_intents` (`owner`);--> statement-breakpoint
CREATE TABLE `booking_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `booking_policies_plan_item` ON `booking_policies` (`owner`,`plan_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `capture_refund_capacity` (
	`capture_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`currency` text NOT NULL,
	`captured` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`refunded` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	CONSTRAINT "capture_refund_capacity_valid" CHECK("capture_refund_capacity"."captured" > 0 AND "capture_refund_capacity"."reserved" >= 0 AND "capture_refund_capacity"."refunded" >= 0 AND "capture_refund_capacity"."reserved" + "capture_refund_capacity"."refunded" <= "capture_refund_capacity"."captured")
);
--> statement-breakpoint
CREATE INDEX `capture_refund_capacity_plan` ON `capture_refund_capacity` (`owner`,`plan_id`);--> statement-breakpoint
CREATE TABLE `recovery_approvals` (
	`proposal_id` text NOT NULL,
	`version` integer NOT NULL,
	`member_id` text NOT NULL,
	`approved` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `version`, `member_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `recovery_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recovery_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`plan_version` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `booking_policies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recovery_proposal_status_valid" CHECK("recovery_proposals"."status" IN ('review','executing','completed','manual-review','cancelled')),
	CONSTRAINT "recovery_proposal_version_valid" CHECK("recovery_proposals"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `recovery_proposals_plan_updated` ON `recovery_proposals` (`owner`,`plan_id`,`updated`);--> statement-breakpoint
CREATE TABLE `refund_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`refund_id` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `recovery_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capture_id`) REFERENCES `capture_refund_capacity`(`capture_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refund_reservation_amount_valid" CHECK("refund_reservations"."amount" > 0),
	CONSTRAINT "refund_reservation_status_valid" CHECK("refund_reservations"."status" IN ('reserved','submitted','confirmed','failed','manual-review'))
);
--> statement-breakpoint
CREATE INDEX `refund_reservations_proposal` ON `refund_reservations` (`proposal_id`);--> statement-breakpoint
CREATE TABLE `plan_invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`amount` integer NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `plan_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_invoice_payment_positive" CHECK("plan_invoice_payments"."amount">0)
);
--> statement-breakpoint
CREATE INDEX `plan_invoice_payments_invoice` ON `plan_invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `plan_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`terms` text NOT NULL,
	`approved_members` text DEFAULT '[]' NOT NULL,
	`amount` integer NOT NULL,
	`minimum` integer NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`provider_status` text,
	`version` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`last_error` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_invoice_amounts_valid" CHECK("plan_invoices"."amount">0 AND "plan_invoices"."minimum">0 AND "plan_invoices"."minimum"<="plan_invoices"."amount" AND "plan_invoices"."paid">=0 AND "plan_invoices"."paid"<="plan_invoices"."amount"),
	CONSTRAINT "plan_invoice_version_valid" CHECK("plan_invoices"."version">=0 AND "plan_invoices"."revision">0),
	CONSTRAINT "plan_invoice_status_valid" CHECK("plan_invoices"."status" IN ('creating','draft','sending','sent','partially-paid','paid','cancelling','cancelled','needs-review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_invoices_provider_id_unique` ON `plan_invoices` (`provider_id`);--> statement-breakpoint
CREATE INDEX `plan_invoices_scope` ON `plan_invoices` (`owner`,`plan_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `plan_invoices_pending` ON `plan_invoices` (`status`,`updated`);--> statement-breakpoint
CREATE TABLE `member_planning_preferences` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `member_id`),
	FOREIGN KEY (`owner`,`plan_id`,`member_id`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "planning_preferences_version_valid" CHECK("member_planning_preferences"."version">=0)
);
--> statement-breakpoint
CREATE TABLE `plan_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `reminder_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_notifications_job_id_unique` ON `plan_notifications` (`job_id`);--> statement-breakpoint
CREATE INDEX `plan_notifications_member` ON `plan_notifications` (`owner`,`plan_id`,`member_id`,`created`);--> statement-breakpoint
CREATE TABLE `reminder_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`member_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_due_at` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`timezone` text NOT NULL,
	`lead_minutes` integer NOT NULL,
	`channel` text NOT NULL,
	`due_at` integer NOT NULL,
	`plan_version` integer NOT NULL,
	`preferences_version` integer NOT NULL,
	`invoice_version` integer DEFAULT -1 NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`last_error` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`delivered` text,
	FOREIGN KEY (`owner`,`plan_id`,`member_id`) REFERENCES `plan_members`(`owner`,`plan_id`,`member_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reminder_job_channel_valid" CHECK("reminder_jobs"."channel" IN ('in-app','email','push')),
	CONSTRAINT "reminder_job_source_valid" CHECK("reminder_jobs"."source_kind" IN ('task','item-deadline','reminder','invoice')),
	CONSTRAINT "reminder_job_status_valid" CHECK("reminder_jobs"."status" IN ('scheduled','processing','delivered','cancelled','unavailable')),
	CONSTRAINT "reminder_job_numbers_valid" CHECK("reminder_jobs"."attempts">=0 AND "reminder_jobs"."lead_minutes">=0 AND "reminder_jobs"."plan_version">=0 AND "reminder_jobs"."preferences_version">=0)
);
--> statement-breakpoint
CREATE INDEX `reminder_jobs_due` ON `reminder_jobs` (`status`,`due_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `reminder_jobs_member` ON `reminder_jobs` (`owner`,`plan_id`,`member_id`);--> statement-breakpoint
CREATE TRIGGER financial_events_no_update BEFORE UPDATE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial facts are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER financial_events_no_delete BEFORE DELETE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial facts are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER financial_event_history_no_update BEFORE UPDATE ON financial_event_history BEGIN SELECT RAISE(ABORT,'Financial history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER financial_event_history_no_delete BEFORE DELETE ON financial_event_history BEGIN SELECT RAISE(ABORT,'Financial history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER approval_revisions_no_update BEFORE UPDATE ON approval_revisions BEGIN SELECT RAISE(ABORT,'Approval snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER approval_revisions_no_delete BEFORE DELETE ON approval_revisions BEGIN SELECT RAISE(ABORT,'Approval snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER approval_members_no_update BEFORE UPDATE ON approval_members BEGIN SELECT RAISE(ABORT,'Approval history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER approval_members_no_delete BEFORE DELETE ON approval_members BEGIN SELECT RAISE(ABORT,'Approval history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER provider_request_intents_no_update BEFORE UPDATE ON provider_request_intents BEGIN SELECT RAISE(ABORT,'Provider intents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER provider_request_intents_no_delete BEFORE DELETE ON provider_request_intents BEGIN SELECT RAISE(ABORT,'Provider intents are immutable'); END;
