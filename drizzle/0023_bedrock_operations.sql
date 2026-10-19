-- Metadata-only AI accounting; no prompts, model output, media, credentials or raw errors.
CREATE TABLE `bedrock_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`reserved_tokens` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`latency_ms` integer,
	`error_code` text,
	`diagnostic` text,
	FOREIGN KEY (`operation_id`) REFERENCES `bedrock_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bedrock_invocation_state_valid" CHECK("bedrock_invocations"."state" IN ('running','succeeded','failed','abandoned')),
	CONSTRAINT "bedrock_invocation_reservation_valid" CHECK("bedrock_invocations"."reserved_tokens">0),
	CONSTRAINT "bedrock_invocation_time_valid" CHECK("bedrock_invocations"."started_at">=0 AND "bedrock_invocations"."expires_at">"bedrock_invocations"."started_at" AND ("bedrock_invocations"."completed_at" IS NULL OR "bedrock_invocations"."completed_at">="bedrock_invocations"."started_at")),
	CONSTRAINT "bedrock_invocation_usage_valid" CHECK(("bedrock_invocations"."input_tokens" IS NULL AND "bedrock_invocations"."output_tokens" IS NULL AND "bedrock_invocations"."total_tokens" IS NULL AND "bedrock_invocations"."estimated_cost_usd" IS NULL) OR ("bedrock_invocations"."input_tokens" IS NOT NULL AND "bedrock_invocations"."output_tokens" IS NOT NULL AND "bedrock_invocations"."total_tokens" IS NOT NULL AND "bedrock_invocations"."input_tokens">=0 AND "bedrock_invocations"."output_tokens">=0 AND "bedrock_invocations"."total_tokens"="bedrock_invocations"."input_tokens"+"bedrock_invocations"."output_tokens" AND "bedrock_invocations"."total_tokens"<=1000000 AND ("bedrock_invocations"."estimated_cost_usd" IS NULL OR "bedrock_invocations"."estimated_cost_usd">=0))),
	CONSTRAINT "bedrock_invocation_latency_valid" CHECK("bedrock_invocations"."latency_ms" IS NULL OR ("bedrock_invocations"."latency_ms">=0 AND "bedrock_invocations"."latency_ms"<=300000))
);
--> statement-breakpoint
CREATE INDEX `bedrock_invocations_window` ON `bedrock_invocations` (`started_at`);
--> statement-breakpoint
CREATE INDEX `bedrock_invocations_operation` ON `bedrock_invocations` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `bedrock_invocations_expiry` ON `bedrock_invocations` (`state`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `bedrock_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`member_id` text NOT NULL,
	`plan_id` text,
	`feature` text NOT NULL,
	`configuration_hash` text NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`error_code` text,
	CONSTRAINT "bedrock_operation_feature_valid" CHECK("bedrock_operations"."feature" IN ('chat','agent','plan-draft','receipt-image','receipt-pdf','diagnostic')),
	CONSTRAINT "bedrock_operation_hash_valid" CHECK(length("bedrock_operations"."configuration_hash")=64 AND "bedrock_operations"."configuration_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "bedrock_operation_state_valid" CHECK("bedrock_operations"."state" IN ('running','succeeded','failed','abandoned')),
	CONSTRAINT "bedrock_operation_time_valid" CHECK("bedrock_operations"."started_at">=0 AND "bedrock_operations"."expires_at">"bedrock_operations"."started_at" AND ("bedrock_operations"."completed_at" IS NULL OR "bedrock_operations"."completed_at">="bedrock_operations"."started_at"))
);
--> statement-breakpoint
CREATE INDEX `bedrock_operations_scope` ON `bedrock_operations` (`owner`,`plan_id`,`configuration_hash`,`started_at`);
--> statement-breakpoint
CREATE INDEX `bedrock_operations_expiry` ON `bedrock_operations` (`state`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `bedrock_workflow_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`owner` text NOT NULL,
	`member_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`feature` text NOT NULL,
	`configuration_hash` text NOT NULL,
	`scope` text NOT NULL,
	`reference_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `bedrock_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bedrock_evidence_feature_valid" CHECK("bedrock_workflow_evidence"."feature" IN ('chat','agent','plan-draft','receipt-image','receipt-pdf')),
	CONSTRAINT "bedrock_evidence_config_hash_valid" CHECK(length("bedrock_workflow_evidence"."configuration_hash")=64 AND "bedrock_workflow_evidence"."configuration_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "bedrock_evidence_reference_hash_valid" CHECK(length("bedrock_workflow_evidence"."reference_hash")=64 AND "bedrock_workflow_evidence"."reference_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "bedrock_evidence_scope_valid" CHECK("bedrock_workflow_evidence"."scope" IN ('saved-chat-readback','saved-agent-proposal-readback','draft-preview-constructed','saved-image-receipt-readback','saved-pdf-receipt-readback')),
	CONSTRAINT "bedrock_evidence_time_valid" CHECK("bedrock_workflow_evidence"."created_at">=0)
);
--> statement-breakpoint
CREATE INDEX `bedrock_workflow_evidence_scope` ON `bedrock_workflow_evidence` (`owner`,`plan_id`,`configuration_hash`,`feature`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bedrock_workflow_evidence_operation_scope` ON `bedrock_workflow_evidence` (`operation_id`,`scope`);
