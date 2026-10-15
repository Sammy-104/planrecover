CREATE TABLE `ai_usage_limits` (
	`member_id` text NOT NULL,
	`feature` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`lease_token` text,
	PRIMARY KEY(`member_id`, `feature`),
	CONSTRAINT "ai_usage_feature_valid" CHECK("ai_usage_limits"."feature" IN ('plan-draft','receipt-extraction')),
	CONSTRAINT "ai_usage_count_valid" CHECK("ai_usage_limits"."request_count" >= 1 AND "ai_usage_limits"."request_count" <= 20)
);
