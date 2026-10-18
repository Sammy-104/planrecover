CREATE TABLE `external_recovery_approvals` (
	`resolution_id` text NOT NULL,
	`member_id` text NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`resolution_id`, `member_id`),
	FOREIGN KEY (`resolution_id`) REFERENCES `external_recovery_resolutions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `external_recovery_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`item_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`created` text NOT NULL,
	`created_by` text NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`owner`,`plan_id`) REFERENCES `plans`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "external_recovery_status_valid" CHECK("external_recovery_resolutions"."status" IN ('review','completed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `external_recovery_resolutions_scope` ON `external_recovery_resolutions` (`owner`,`plan_id`,`created`);--> statement-breakpoint
CREATE TABLE `invoice_refund_allocations` (
	`request_id` text NOT NULL,
	`refund_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`request_id`, `refund_id`),
	FOREIGN KEY (`request_id`) REFERENCES `invoice_refund_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_id`) REFERENCES `invoice_refunds`(`refund_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_refund_allocation_amount_valid" CHECK("invoice_refund_allocations"."amount">0)
);
--> statement-breakpoint
CREATE INDEX `invoice_refund_allocations_refund` ON `invoice_refund_allocations` (`refund_id`);
--> statement-breakpoint

CREATE TRIGGER invoice_refund_allocation_capacity BEFORE INSERT ON invoice_refund_allocations BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM invoice_refund_requests q JOIN invoice_refunds r ON r.invoice_id=q.invoice_id AND r.owner=q.owner AND r.plan_id=q.plan_id
  WHERE q.id=NEW.request_id AND r.refund_id=NEW.refund_id AND q.status IN ('awaiting-merchant','completed')
   AND q.approved_owner=1 AND q.approved_member=1
   AND NOT EXISTS(SELECT 1 FROM json_each(q.terms,'$.previousRefunds') p WHERE p.value=r.refund_id)
   AND NEW.amount+(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=q.id)<=q.amount
   AND NEW.amount+(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.refund_id=r.refund_id)<=r.amount
 ) THEN RAISE(ABORT,'invoice refund evidence capacity exceeded') END;
END;

--> statement-breakpoint

CREATE TRIGGER invoice_refund_allocations_immutable BEFORE UPDATE ON invoice_refund_allocations BEGIN SELECT RAISE(ABORT,'invoice refund allocations are immutable'); END;

--> statement-breakpoint

CREATE TRIGGER invoice_refund_allocations_retained BEFORE DELETE ON invoice_refund_allocations BEGIN SELECT RAISE(ABORT,'invoice refund allocations are retained'); END;

--> statement-breakpoint

CREATE TRIGGER external_recovery_terms_immutable BEFORE UPDATE OF id,owner,plan_id,item_id,body,created,created_by ON external_recovery_resolutions BEGIN SELECT RAISE(ABORT,'external recovery terms are immutable'); END;

--> statement-breakpoint

CREATE TRIGGER external_recovery_terms_retained BEFORE DELETE ON external_recovery_resolutions BEGIN SELECT RAISE(ABORT,'external recovery terms are retained'); END;

--> statement-breakpoint

CREATE TRIGGER external_recovery_approvals_immutable BEFORE UPDATE ON external_recovery_approvals BEGIN SELECT RAISE(ABORT,'external recovery approvals are immutable'); END;

--> statement-breakpoint

CREATE TRIGGER external_recovery_approvals_retained BEFORE DELETE ON external_recovery_approvals BEGIN SELECT RAISE(ABORT,'external recovery approvals are retained'); END;

