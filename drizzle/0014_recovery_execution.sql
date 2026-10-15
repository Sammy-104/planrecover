ALTER TABLE `recovery_proposals` ADD `execution_token` text;--> statement-breakpoint
ALTER TABLE `recovery_proposals` ADD `execution_until` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER booking_policies_no_update BEFORE UPDATE ON booking_policies BEGIN SELECT RAISE(ABORT,'Booking policies are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER booking_policies_no_delete BEFORE DELETE ON booking_policies BEGIN SELECT RAISE(ABORT,'Booking policies are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_proposals_snapshot_immutable BEFORE UPDATE OF id,owner,plan_id,policy_id,plan_version,version,body,created_by,created ON recovery_proposals BEGIN SELECT RAISE(ABORT,'Recovery approval snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_proposals_no_delete BEFORE DELETE ON recovery_proposals BEGIN SELECT RAISE(ABORT,'Recovery history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_approvals_no_update BEFORE UPDATE ON recovery_approvals BEGIN SELECT RAISE(ABORT,'Recovery approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_approvals_no_delete BEFORE DELETE ON recovery_approvals BEGIN SELECT RAISE(ABORT,'Recovery approvals are immutable'); END;
