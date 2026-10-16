CREATE TABLE `agent_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`member_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input` text NOT NULL,
	`result` text,
	`status` text DEFAULT 'prepared' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tool_calls_conversation_id_request_id_tool_name_input_unique` ON `agent_tool_calls` (`conversation_id`,`request_id`,`tool_name`,`input`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_owner_member_id_conversation_id_created_idx` ON `agent_tool_calls` (`owner`,`member_id`,`conversation_id`,`created`);--> statement-breakpoint
CREATE TABLE `invoice_collection_closures` (
	`invoice_id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`amount` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'awaiting-merchant' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`terms` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`created` text NOT NULL,
	`approved_owner` integer DEFAULT 0 NOT NULL,
	`approved_member` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_refund_amount_valid" CHECK(amount>0),
	CONSTRAINT "invoice_refund_currency_valid" CHECK(currency='CAD')
);
--> statement-breakpoint
CREATE INDEX `invoice_refund_requests_invoice_id_status_idx` ON `invoice_refund_requests` (`invoice_id`,`status`);--> statement-breakpoint
CREATE TABLE `invoice_refunds` (
	`refund_id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`amount` integer NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	CONSTRAINT "invoice_refund_amount_valid" CHECK(amount>0)
);
--> statement-breakpoint
CREATE INDEX `invoice_refunds_invoice_id_idx` ON `invoice_refunds` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `plan_change_steps` (
	`change_id` text NOT NULL,
	`step_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`reference_id` text,
	`status` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`change_id`, `step_id`),
	FOREIGN KEY (`change_id`) REFERENCES `plan_changes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_bookings` (
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `plan_id`, `item_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_bookings_owner_booking_id_unique` ON `supplier_bookings` (`owner`,`booking_id`);--> statement-breakpoint
CREATE INDEX `supplier_bookings_owner_status_updated_idx` ON `supplier_bookings` (`owner`,`status`,`updated`);--> statement-breakpoint
CREATE TABLE `supplier_disruptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_disruptions_owner_booking_id_status_unique` ON `supplier_disruptions` (`owner`,`booking_id`,`status`);--> statement-breakpoint
ALTER TABLE `plan_invoices` ADD `lifecycle_status` text;--> statement-breakpoint
ALTER TABLE `reminder_jobs` ADD `source_type` text;
--> statement-breakpoint
CREATE TRIGGER invoice_refund_terms_immutable BEFORE UPDATE OF owner,plan_id,invoice_id,member_id,amount,currency,terms,created ON invoice_refund_requests BEGIN SELECT RAISE(ABORT,'invoice refund terms are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_refund_facts_immutable BEFORE UPDATE ON invoice_refunds BEGIN SELECT RAISE(ABORT,'invoice refund facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER invoice_refund_facts_retained BEFORE DELETE ON invoice_refunds BEGIN SELECT RAISE(ABORT,'invoice refund facts are retained'); END;
