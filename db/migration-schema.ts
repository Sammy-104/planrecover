// Complete migration schema. Runtime helpers retain their existing exports in schema.ts.
import {sqliteTable,text,integer,real,blob,primaryKey,index,uniqueIndex,foreignKey,unique,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';

export const t_ai_usage_limits=sqliteTable("ai_usage_limits",{
 member_id:text("member_id").notNull(),
 feature:text("feature").notNull(),
 window_start:integer("window_start").notNull(),
 request_count:integer("request_count").notNull(),
 lease_until:integer("lease_until").notNull(),
 lease_token:text("lease_token"),
},table=>[
 primaryKey({name:"ai_usage_limits_member_id_feature_pk",columns:[table.member_id,table.feature]}),
 check("ai_usage_feature_valid",sql.raw("\"ai_usage_limits\".\"feature\" IN ('plan-draft','receipt-extraction')")),
 check("ai_usage_count_valid",sql.raw("\"ai_usage_limits\".\"request_count\" >= 1 AND \"ai_usage_limits\".\"request_count\" <= 20")),
]);

export const t_backend_write_guards=sqliteTable("backend_write_guards",{
 id:text("id").primaryKey().notNull(),
 valid:integer("valid").notNull(),
},table=>[
 check("backend_write_guard_valid",sql.raw("\"backend_write_guards\".\"valid\" = 1")),
]);

export const t_member_preferences=sqliteTable("member_preferences",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 body:text("body").notNull(),
 version:integer("version").notNull().default(0),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"member_preferences_owner_plan_id_member_id_pk",columns:[table.owner,table.plan_id,table.member_id]}),
 foreignKey({name:"member_preferences_owner_plan_id_member_id_plan_members_owner_plan_id_member_id_fk",columns:[table.owner,table.plan_id,table.member_id],foreignColumns:[t_plan_members.owner,t_plan_members.plan_id,t_plan_members.member_id]}).onDelete("no action").onUpdate("no action"),
 check("preferences_version_nonnegative",sql.raw("\"member_preferences\".\"version\" >= 0")),
]);

export const t_plan_members=sqliteTable("plan_members",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 role:text("role").notNull(),
 body:text("body").notNull(),
},table=>[
 primaryKey({name:"plan_members_owner_plan_id_member_id_pk",columns:[table.owner,table.plan_id,table.member_id]}),
 index("plan_members_identity").on(table.member_id),
 foreignKey({name:"plan_members_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
 check("plan_members_role_valid",sql.raw("\"plan_members\".\"role\" IN ('owner','editor','viewer','legacy')")),
]);

export const t_plans=sqliteTable("plans",{
 owner:text("owner").notNull(),
 id:text("id").notNull(),
 name:text("name").notNull(),
 body:text("body").notNull(),
 version:integer("version").notNull().default(0),
 status:text("status").notNull(),
 ordinal:integer("ordinal").notNull().default(0),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"plans_owner_id_pk",columns:[table.owner,table.id]}),
 index("plans_owner_status").on(table.owner,table.status),
 check("plans_version_nonnegative",sql.raw("\"plans\".\"version\" >= 0")),
 check("plans_status_valid",sql.raw("\"plans\".\"status\" IN ('active','archived','deleted')")),
]);

export const t_profiles=sqliteTable("profiles",{
 id:text("id").primaryKey().notNull(),
 display_name:text("display_name").notNull(),
 updated:text("updated").notNull(),
},table=>[
]);

export const t_provider_operations=sqliteTable("provider_operations",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 item_id:text("item_id").notNull(),
 member:text("member").notNull(),
 revision:integer("revision").notNull(),
 kind:text("kind").notNull(),
 amount:integer("amount").notNull(),
 provider_id:text("provider_id"),
 status:text("status").notNull(),
 payload:text("payload"),
},table=>[
 index("idx_provider_operations_provider_kind").on(table.provider_id,table.kind),
]);

export const t_provider_reconciliation_attempts=sqliteTable("provider_reconciliation_attempts",{
 operation_id:text("operation_id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 status:text("status").notNull().default(sql.raw("'ready'")),
 attempts:integer("attempts").notNull().default(0),
 processing_started:text("processing_started"),
 last_attempt:text("last_attempt"),
 last_error:text("last_error"),
 completed:text("completed"),
},table=>[
 index("idx_provider_reconciliation_owner_attempt").on(table.owner,table.last_attempt),
 foreignKey({name:"provider_reconciliation_attempts_operation_id_provider_operations_id_fk",columns:[table.operation_id],foreignColumns:[t_provider_operations.id]}).onDelete("no action").onUpdate("no action"),
 check("provider_reconciliation_attempts_nonnegative",sql.raw("\"provider_reconciliation_attempts\".\"attempts\" >= 0")),
]);

export const t_receipt_drafts=sqliteTable("receipt_drafts",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 uploaded_by:text("uploaded_by").notNull(),
 file_key:text("file_key").notNull(),
 mime:text("mime").notNull(),
 size:integer("size").notNull(),
 status:text("status").notNull(),
 version:integer("version").notNull().default(0),
 source_facts:text("source_facts"),
 unknown_fields:text("unknown_fields").notNull(),
 warnings:text("warnings").notNull(),
 reviewed_receipt:text("reviewed_receipt"),
 provider:text("provider"),
 model_id:text("model_id"),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
},table=>[
 uniqueIndex("receipt_drafts_file_key_unique").on(table.file_key),
 index("receipt_drafts_plan_updated").on(table.owner,table.plan_id,table.updated),
 foreignKey({name:"receipt_drafts_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
 check("receipt_drafts_status_valid",sql.raw("\"receipt_drafts\".\"status\" IN ('uploaded','extracting','review-required','failed','reviewed')")),
 check("receipt_drafts_version_valid",sql.raw("\"receipt_drafts\".\"version\" >= 0")),
 check("receipt_drafts_size_valid",sql.raw("\"receipt_drafts\".\"size\" > 0 AND \"receipt_drafts\".\"size\" <= 8388608")),
]);

export const t_route_provider_slots=sqliteTable("route_provider_slots",{
 id:text("id").primaryKey().notNull(),
 next_at:integer("next_at").notNull(),
},table=>[
]);

export const t_trip_links=sqliteTable("trip_links",{
 token_hash:text("token_hash").primaryKey().notNull(),
 token:text("token").notNull(),
 owner:text("owner").notNull(),
 trip_id:text("trip_id").notNull(),
 role:text("role").notNull().default(sql.raw("'editor'")),
 created:text("created").notNull(),
 expires:text("expires"),
},table=>[
 index("idx_trip_links_owner_trip").on(table.owner,table.trip_id),
]);

export const t_webhook_events=sqliteTable("webhook_events",{
 id:text("id").primaryKey().notNull(),
 body:text("body").notNull(),
 received:text("received").notNull(),
 status:text("status").notNull().default(sql.raw("'received'")),
 attempts:integer("attempts").notNull().default(0),
 processing_started:text("processing_started"),
 last_error:text("last_error"),
 processed:text("processed"),
},table=>[
]);

export const t_workspaces=sqliteTable("workspaces",{
 owner:text("owner").primaryKey().notNull(),
 body:text("body").notNull(),
 version:integer("version").notNull().default(0),
 updated:text("updated").notNull(),
},table=>[
]);

export const t_approval_members=sqliteTable("approval_members",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 revision:integer("revision").notNull(),
 member_id:text("member_id").notNull(),
 approved_at:text("approved_at").notNull(),
},table=>[
 primaryKey({name:"approval_members_owner_plan_id_item_id_revision_member_id_pk",columns:[table.owner,table.plan_id,table.item_id,table.revision,table.member_id]}),
]);

export const t_approval_revisions=sqliteTable("approval_revisions",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 revision:integer("revision").notNull(),
 snapshot:text("snapshot").notNull(),
 created:text("created").notNull(),
},table=>[
 primaryKey({name:"approval_revisions_owner_plan_id_item_id_revision_pk",columns:[table.owner,table.plan_id,table.item_id,table.revision]}),
]);

export const t_financial_event_history=sqliteTable("financial_event_history",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 event_id:text("event_id").notNull(),
 fingerprint:text("fingerprint").notNull(),
 status:text("status").notNull(),
 body:text("body").notNull(),
 recorded:text("recorded").notNull(),
},table=>[
 uniqueIndex("financial_event_transition_unique").on(table.owner,table.plan_id,table.event_id,table.fingerprint),
 index("financial_event_history_plan").on(table.owner,table.plan_id,table.recorded),
]);

export const t_financial_events=sqliteTable("financial_events",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 event_id:text("event_id").notNull(),
 facts:text("facts").notNull(),
 body:text("body").notNull(),
 currency:text("currency").notNull(),
 provider:text("provider"),
 provider_id:text("provider_id"),
 kind:text("kind").notNull(),
 created:text("created").notNull(),
},table=>[
 primaryKey({name:"financial_events_owner_plan_id_event_id_pk",columns:[table.owner,table.plan_id,table.event_id]}),
 uniqueIndex("financial_provider_effect_unique").on(table.provider,table.provider_id,table.kind),
]);

export const t_payment_funding_claims=sqliteTable("payment_funding_claims",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 revision:integer("revision").notNull(),
 member_id:text("member_id").notNull(),
 channel:text("channel").notNull(),
 reference_id:text("reference_id").notNull(),
 created:text("created").notNull(),
},table=>[
 primaryKey({name:"payment_funding_claims_owner_plan_id_item_id_revision_member_id_pk",columns:[table.owner,table.plan_id,table.item_id,table.revision,table.member_id]}),
 check("payment_funding_channel_valid",sql.raw("\"payment_funding_claims\".\"channel\" IN ('order','invoice')")),
]);

export const t_provider_request_intents=sqliteTable("provider_request_intents",{
 operation_id:text("operation_id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 path:text("path").notNull(),
 method:text("method").notNull(),
 request_body:text("request_body").notNull(),
 request_key:text("request_key").notNull(),
 fingerprint:text("fingerprint").notNull(),
 created:text("created").notNull(),
 replay_before:text("replay_before").notNull(),
},table=>[
 index("provider_intents_owner").on(table.owner),
]);

export const t_booking_policies=sqliteTable("booking_policies",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 revision:integer("revision").notNull(),
 body:text("body").notNull(),
 confirmed_by:text("confirmed_by").notNull(),
 created:text("created").notNull(),
},table=>[
 index("booking_policies_plan_item").on(table.owner,table.plan_id,table.item_id),
]);

export const t_capture_refund_capacity=sqliteTable("capture_refund_capacity",{
 capture_id:text("capture_id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 member_id:text("member_id").notNull(),
 currency:text("currency").notNull(),
 captured:integer("captured").notNull(),
 reserved:integer("reserved").notNull().default(0),
 refunded:integer("refunded").notNull().default(0),
 updated:text("updated").notNull(),
},table=>[
 index("capture_refund_capacity_plan").on(table.owner,table.plan_id),
 check("capture_refund_capacity_valid",sql.raw("\"capture_refund_capacity\".\"captured\" > 0 AND \"capture_refund_capacity\".\"reserved\" >= 0 AND \"capture_refund_capacity\".\"refunded\" >= 0 AND \"capture_refund_capacity\".\"reserved\" + \"capture_refund_capacity\".\"refunded\" <= \"capture_refund_capacity\".\"captured\"")),
]);

export const t_capture_refund_claims=sqliteTable("capture_refund_claims",{
 id:text("id").primaryKey().notNull(),
 capture_id:text("capture_id").notNull(),
 amount:integer("amount").notNull(),
 status:text("status").notNull(),
 created:text("created").notNull(),
},table=>[
 index("capture_refund_claims_capture").on(table.capture_id),
 foreignKey({name:"capture_refund_claims_capture_id_capture_refund_capacity_capture_id_fk",columns:[table.capture_id],foreignColumns:[t_capture_refund_capacity.capture_id]}).onDelete("no action").onUpdate("no action"),
 check("capture_refund_claim_amount_valid",sql.raw("\"capture_refund_claims\".\"amount\" > 0")),
 check("capture_refund_claim_status_valid",sql.raw("\"capture_refund_claims\".\"status\" IN ('reserved','confirmed')")),
]);

export const t_recovery_approvals=sqliteTable("recovery_approvals",{
 proposal_id:text("proposal_id").notNull(),
 version:integer("version").notNull(),
 member_id:text("member_id").notNull(),
 approved:text("approved").notNull(),
},table=>[
 primaryKey({name:"recovery_approvals_proposal_id_version_member_id_pk",columns:[table.proposal_id,table.version,table.member_id]}),
 foreignKey({name:"recovery_approvals_proposal_id_recovery_proposals_id_fk",columns:[table.proposal_id],foreignColumns:[t_recovery_proposals.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_recovery_proposals=sqliteTable("recovery_proposals",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 policy_id:text("policy_id").notNull(),
 plan_version:integer("plan_version").notNull(),
 version:integer("version").notNull().default(1),
 status:text("status").notNull(),
 body:text("body").notNull(),
 created_by:text("created_by").notNull(),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
 execution_token:text("execution_token"),
 execution_until:integer("execution_until").notNull().default(0),
},table=>[
 index("recovery_proposals_plan_updated").on(table.owner,table.plan_id,table.updated),
 foreignKey({name:"recovery_proposals_policy_id_booking_policies_id_fk",columns:[table.policy_id],foreignColumns:[t_booking_policies.id]}).onDelete("no action").onUpdate("no action"),
 check("recovery_proposal_status_valid",sql.raw("\"recovery_proposals\".\"status\" IN ('review','executing','completed','manual-review','cancelled')")),
 check("recovery_proposal_version_valid",sql.raw("\"recovery_proposals\".\"version\" >= 1")),
]);

export const t_refund_reservations=sqliteTable("refund_reservations",{
 id:text("id").primaryKey().notNull(),
 proposal_id:text("proposal_id").notNull(),
 capture_id:text("capture_id").notNull(),
 member_id:text("member_id").notNull(),
 amount:integer("amount").notNull(),
 currency:text("currency").notNull(),
 status:text("status").notNull(),
 refund_id:text("refund_id"),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
},table=>[
 index("refund_reservations_proposal").on(table.proposal_id),
 foreignKey({name:"refund_reservations_proposal_id_recovery_proposals_id_fk",columns:[table.proposal_id],foreignColumns:[t_recovery_proposals.id]}).onDelete("no action").onUpdate("no action"),
 foreignKey({name:"refund_reservations_capture_id_capture_refund_capacity_capture_id_fk",columns:[table.capture_id],foreignColumns:[t_capture_refund_capacity.capture_id]}).onDelete("no action").onUpdate("no action"),
 check("refund_reservation_amount_valid",sql.raw("\"refund_reservations\".\"amount\" > 0")),
 check("refund_reservation_status_valid",sql.raw("\"refund_reservations\".\"status\" IN ('reserved','submitted','confirmed','failed','manual-review')")),
]);

export const t_plan_invoice_payments=sqliteTable("plan_invoice_payments",{
 id:text("id").primaryKey().notNull(),
 invoice_id:text("invoice_id").notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 amount:integer("amount").notNull(),
 body:text("body").notNull(),
 created:text("created").notNull(),
},table=>[
 index("plan_invoice_payments_invoice").on(table.invoice_id),
 foreignKey({name:"plan_invoice_payments_invoice_id_plan_invoices_id_fk",columns:[table.invoice_id],foreignColumns:[t_plan_invoices.id]}).onDelete("no action").onUpdate("no action"),
 check("plan_invoice_payment_positive",sql.raw("\"plan_invoice_payments\".\"amount\">0")),
]);

export const t_plan_invoices=sqliteTable("plan_invoices",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 member_id:text("member_id").notNull(),
 revision:integer("revision").notNull(),
 request_id:text("request_id").notNull(),
 terms:text("terms").notNull(),
 approved_members:text("approved_members").notNull().default(sql.raw("'[]'")),
 amount:integer("amount").notNull(),
 minimum:integer("minimum").notNull(),
 paid:integer("paid").notNull().default(0),
 provider_id:text("provider_id"),
 provider_url:text("provider_url"),
 status:text("status").notNull(),
 provider_status:text("provider_status"),
 version:integer("version").notNull().default(0),
 lease_until:integer("lease_until").notNull().default(0),
 lease_token:text("lease_token"),
 last_error:text("last_error"),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
 lifecycle_status:text("lifecycle_status"),
},table=>[
 uniqueIndex("plan_invoices_provider_id_unique").on(table.provider_id),
 index("plan_invoices_scope").on(table.owner,table.plan_id,table.member_id),
 index("plan_invoices_pending").on(table.status,table.updated),
 foreignKey({name:"plan_invoices_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
 check("plan_invoice_amounts_valid",sql.raw("\"plan_invoices\".\"amount\">0 AND \"plan_invoices\".\"minimum\">0 AND \"plan_invoices\".\"minimum\"<=\"plan_invoices\".\"amount\" AND \"plan_invoices\".\"paid\">=0 AND \"plan_invoices\".\"paid\"<=\"plan_invoices\".\"amount\"")),
 check("plan_invoice_version_valid",sql.raw("\"plan_invoices\".\"version\">=0 AND \"plan_invoices\".\"revision\">0")),
 check("plan_invoice_status_valid",sql.raw("\"plan_invoices\".\"status\" IN ('creating','draft','sending','sent','partially-paid','paid','cancelling','cancelled','needs-review')")),
]);

export const t_member_planning_preferences=sqliteTable("member_planning_preferences",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 body:text("body").notNull(),
 version:integer("version").notNull().default(0),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"member_planning_preferences_owner_plan_id_member_id_pk",columns:[table.owner,table.plan_id,table.member_id]}),
 foreignKey({name:"member_planning_preferences_owner_plan_id_member_id_plan_members_owner_plan_id_member_id_fk",columns:[table.owner,table.plan_id,table.member_id],foreignColumns:[t_plan_members.owner,t_plan_members.plan_id,t_plan_members.member_id]}).onDelete("no action").onUpdate("no action"),
 check("planning_preferences_version_valid",sql.raw("\"member_planning_preferences\".\"version\">=0")),
]);

export const t_plan_notifications=sqliteTable("plan_notifications",{
 id:text("id").primaryKey().notNull(),
 job_id:text("job_id").notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 title:text("title").notNull(),
 body:text("body").notNull(),
 created:text("created").notNull(),
 read_at:text("read_at"),
},table=>[
 uniqueIndex("plan_notifications_job_id_unique").on(table.job_id),
 index("plan_notifications_member").on(table.owner,table.plan_id,table.member_id,table.created),
 foreignKey({name:"plan_notifications_job_id_reminder_jobs_id_fk",columns:[table.job_id],foreignColumns:[t_reminder_jobs.id]}).onDelete("no action").onUpdate("no action"),
 foreignKey({name:"plan_notifications_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_reminder_jobs=sqliteTable("reminder_jobs",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 source_kind:text("source_kind").notNull(),
 source_id:text("source_id").notNull(),
 source_due_at:integer("source_due_at").notNull(),
 title:text("title").notNull(),
 body:text("body").notNull(),
 timezone:text("timezone").notNull(),
 lead_minutes:integer("lead_minutes").notNull(),
 channel:text("channel").notNull(),
 due_at:integer("due_at").notNull(),
 plan_version:integer("plan_version").notNull(),
 preferences_version:integer("preferences_version").notNull(),
 invoice_version:integer("invoice_version").notNull().default(-1),
 status:text("status").notNull().default(sql.raw("'scheduled'")),
 attempts:integer("attempts").notNull().default(0),
 lease_until:integer("lease_until").notNull().default(0),
 lease_token:text("lease_token"),
 last_error:text("last_error"),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
 delivered:text("delivered"),
 source_type:text("source_type"),
},table=>[
 index("reminder_jobs_due").on(table.status,table.due_at,table.lease_until),
 index("reminder_jobs_member").on(table.owner,table.plan_id,table.member_id),
 foreignKey({name:"reminder_jobs_owner_plan_id_member_id_plan_members_owner_plan_id_member_id_fk",columns:[table.owner,table.plan_id,table.member_id],foreignColumns:[t_plan_members.owner,t_plan_members.plan_id,t_plan_members.member_id]}).onDelete("no action").onUpdate("no action"),
 check("reminder_job_channel_valid",sql.raw("\"reminder_jobs\".\"channel\" IN ('in-app','email','push')")),
 check("reminder_job_source_valid",sql.raw("\"reminder_jobs\".\"source_kind\" IN ('task','item-deadline','reminder','invoice')")),
 check("reminder_job_status_valid",sql.raw("\"reminder_jobs\".\"status\" IN ('scheduled','processing','delivered','cancelled','unavailable')")),
 check("reminder_job_numbers_valid",sql.raw("\"reminder_jobs\".\"attempts\">=0 AND \"reminder_jobs\".\"lead_minutes\">=0 AND \"reminder_jobs\".\"plan_version\">=0 AND \"reminder_jobs\".\"preferences_version\">=0")),
]);

export const t_background_job_runs=sqliteTable("background_job_runs",{
 owner:text("owner").primaryKey().notNull(),
 lease_token:text("lease_token"),
 lease_until:integer("lease_until").notNull().default(0),
 next_at:integer("next_at").notNull().default(0),
 reminder_cursor:text("reminder_cursor"),
 last_started:text("last_started"),
 last_completed:text("last_completed"),
 last_result:text("last_result"),
 status:text("status").notNull().default(sql.raw("'idle'")),
},table=>[
]);

export const t_planning_evidence=sqliteTable("planning_evidence",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 kind:text("kind").notNull(),
 subject_key:text("subject_key").notNull(),
 body:text("body").notNull(),
 subject_snapshot:text("subject_snapshot").notNull(),
 source_url:text("source_url").notNull(),
 checked_at:text("checked_at").notNull(),
 confirmed_by:text("confirmed_by").notNull(),
 status:text("status").notNull().default(sql.raw("'active'")),
 version:integer("version").notNull().default(1),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"planning_evidence_owner_plan_id_kind_subject_key_pk",columns:[table.owner,table.plan_id,table.kind,table.subject_key]}),
 index("planning_evidence_plan").on(table.owner,table.plan_id,table.kind),
 foreignKey({name:"planning_evidence_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
 check("planning_evidence_kind_valid",sql.raw("\"planning_evidence\".\"kind\" IN ('supplier','travel')")),
 check("planning_evidence_version_valid",sql.raw("\"planning_evidence\".\"version\">0")),
 check("planning_evidence_status_valid",sql.raw("\"planning_evidence\".\"status\" IN ('active','revoked')")),
]);

export const t_adapter_operations=sqliteTable("adapter_operations",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 provider:text("provider").notNull(),
 kind:text("kind").notNull(),
 request:text("request").notNull(),
 response:text("response"),
 status:text("status").notNull().default(sql.raw("'prepared'")),
 lease_token:text("lease_token"),
 lease_until:integer("lease_until").notNull().default(0),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
},table=>[
 index("adapter_operations_scope").on(table.owner,table.plan_id,table.created),
 uniqueIndex("controlled_reminder_email_once").on(table.owner,table.plan_id,table.member_id,sql`json_extract(${table.request}, '$.sourceJobId')`).where(sql`${table.provider}='aws-ses' AND ${table.kind}='controlled-self-test'`),
]);

export const t_agent_proposals=sqliteTable("agent_proposals",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 member_id:text("member_id").notNull(),
 plan_id:text("plan_id"),
 body:text("body").notNull(),
 plan_version:integer("plan_version").notNull(),
 status:text("status").notNull().default(sql.raw("'review'")),
 result:text("result"),
 created:text("created").notNull(),
},table=>[
 index("agent_proposals_member").on(table.owner,table.member_id,table.created),
]);

export const t_assistant_conversations=sqliteTable("assistant_conversations",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 member_id:text("member_id").notNull(),
 plan_id:text("plan_id"),
 context_actor:text("context_actor").notNull().default(sql.raw("''")),
 title:text("title").notNull(),
 version:integer("version").notNull().default(0),
 lease_token:text("lease_token"),
 lease_until:integer("lease_until").notNull().default(0),
 created:text("created").notNull(),
 updated:text("updated").notNull(),
},table=>[
 index("assistant_conversations_member").on(table.owner,table.member_id,table.updated),
]);

export const t_assistant_messages=sqliteTable("assistant_messages",{
 id:text("id").primaryKey().notNull(),
 conversation_id:text("conversation_id").notNull(),
 request_id:text("request_id").notNull(),
 role:text("role").notNull(),
 text:text("text").notNull(),
 mode:text("mode").notNull(),
 metadata:text("metadata").notNull().default(sql.raw("'{}'")),
 created:text("created").notNull(),
},table=>[
 uniqueIndex("assistant_messages_request_role").on(table.conversation_id,table.request_id,table.role),
 index("assistant_messages_history").on(table.conversation_id,table.created,table.id),
 foreignKey({name:"assistant_messages_conversation_id_assistant_conversations_id_fk",columns:[table.conversation_id],foreignColumns:[t_assistant_conversations.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_notification_destinations=sqliteTable("notification_destinations",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 member_id:text("member_id").notNull(),
 channel:text("channel").notNull(),
 destination:text("destination").notNull(),
 version:integer("version").notNull().default(0),
 confirmed_at:text("confirmed_at").notNull(),
},table=>[
 primaryKey({name:"notification_destinations_owner_plan_id_member_id_channel_pk",columns:[table.owner,table.plan_id,table.member_id,table.channel]}),
]);

export const t_plan_change_approvals=sqliteTable("plan_change_approvals",{
 change_id:text("change_id").notNull(),
 member_id:text("member_id").notNull(),
 approved_at:text("approved_at").notNull(),
},table=>[
 primaryKey({name:"plan_change_approvals_change_id_member_id_pk",columns:[table.change_id,table.member_id]}),
 foreignKey({name:"plan_change_approvals_change_id_plan_changes_id_fk",columns:[table.change_id],foreignColumns:[t_plan_changes.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_plan_changes=sqliteTable("plan_changes",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 body:text("body").notNull(),
 status:text("status").notNull().default(sql.raw("'review'")),
 created:text("created").notNull(),
 created_by:text("created_by").notNull(),
 applied_at:text("applied_at"),
},table=>[
 index("plan_changes_scope").on(table.owner,table.plan_id,table.created),
 foreignKey({name:"plan_changes_owner_plan_id_plans_owner_id_fk",columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_receipt_objects=sqliteTable("receipt_objects",{
 file_key:text("file_key").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 status:text("status").notNull().default(sql.raw("'staged'")),
 created:text("created").notNull(),
 lease_token:text("lease_token"),
 lease_until:integer("lease_until").notNull().default(0),
 deleted_at:text("deleted_at"),
 source_sha256:text("source_sha256"),
},table=>[
 index("receipt_objects_cleanup").on(table.status,table.created,table.lease_until),
]);

export const t_receipt_revisions=sqliteTable("receipt_revisions",{
 draft_id:text("draft_id").notNull(),
 version:integer("version").notNull(),
 body:text("body").notNull(),
 created:text("created").notNull(),
},table=>[
 primaryKey({name:"receipt_revisions_draft_id_version_pk",columns:[table.draft_id,table.version]}),
]);

export const t_plan_change_steps=sqliteTable("plan_change_steps",{
 change_id:text("change_id").notNull(),
 step_id:text("step_id").notNull(),
 kind:text("kind").notNull(),
 item_id:text("item_id").notNull(),
 reference_id:text("reference_id"),
 status:text("status").notNull(),
 detail:text("detail").notNull().default(sql.raw("'{}'")),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"plan_change_steps_change_id_step_id_pk",columns:[table.change_id,table.step_id]}),
 foreignKey({name:"plan_change_steps_change_id_plan_changes_id_fk",columns:[table.change_id],foreignColumns:[t_plan_changes.id]}).onDelete("no action").onUpdate("no action"),
]);

export const t_supplier_bookings=sqliteTable("supplier_bookings",{
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 revision:integer("revision").notNull(),
 operation_id:text("operation_id").notNull(),
 booking_id:text("booking_id").notNull(),
 quote_id:text("quote_id").notNull(),
 status:text("status").notNull(),
 amount:integer("amount").notNull(),
 currency:text("currency").notNull(),
 updated:text("updated").notNull(),
},table=>[
 primaryKey({name:"supplier_bookings_owner_plan_id_item_id_revision_pk",columns:[table.owner,table.plan_id,table.item_id,table.revision]}),
 uniqueIndex("supplier_bookings_owner_booking_id_unique").on(table.owner,table.booking_id),
 index("supplier_bookings_owner_status_updated_idx").on(table.owner,table.status,table.updated),
]);

export const t_supplier_disruptions=sqliteTable("supplier_disruptions",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 item_id:text("item_id").notNull(),
 booking_id:text("booking_id").notNull(),
 status:text("status").notNull(),
 created:text("created").notNull(),
},table=>[
 uniqueIndex("supplier_disruptions_owner_booking_id_status_unique").on(table.owner,table.booking_id,table.status),
]);

export const t_agent_tool_calls=sqliteTable("agent_tool_calls",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 member_id:text("member_id").notNull(),
 conversation_id:text("conversation_id").notNull(),
 request_id:text("request_id").notNull(),
 tool_name:text("tool_name").notNull(),
 input:text("input").notNull(),
 result:text("result"),
 status:text("status").notNull().default(sql.raw("'prepared'")),
 created:text("created").notNull(),
},table=>[
 uniqueIndex("agent_tool_calls_conversation_id_request_id_tool_name_input_unique").on(table.conversation_id,table.request_id,table.tool_name,table.input),
 index("agent_tool_calls_owner_member_id_conversation_id_created_idx").on(table.owner,table.member_id,table.conversation_id,table.created),
]);

export const t_invoice_refund_requests=sqliteTable("invoice_refund_requests",{
 id:text("id").primaryKey().notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 invoice_id:text("invoice_id").notNull(),
 member_id:text("member_id").notNull(),
 amount:integer("amount").notNull(),
 currency:text("currency").notNull(),
 terms:text("terms").notNull(),
 status:text("status").notNull().default(sql.raw("'review'")),
 created:text("created").notNull(),
 approved_owner:integer("approved_owner").notNull().default(0),
 approved_member:integer("approved_member").notNull().default(0),
},table=>[
 index("invoice_refund_requests_invoice_id_status_idx").on(table.invoice_id,table.status),
 check("invoice_refund_amount_valid",sql.raw("amount>0")),
 check("invoice_refund_currency_valid",sql.raw("currency='CAD'")),
]);

export const t_invoice_refunds=sqliteTable("invoice_refunds",{
 refund_id:text("refund_id").primaryKey().notNull(),
 invoice_id:text("invoice_id").notNull(),
 owner:text("owner").notNull(),
 plan_id:text("plan_id").notNull(),
 amount:integer("amount").notNull(),
 body:text("body").notNull(),
 created:text("created").notNull(),
},table=>[
 index("invoice_refunds_invoice_id_idx").on(table.invoice_id),
 check("invoice_refund_amount_valid",sql.raw("amount>0")),
]);

export const t_invoice_collection_closures=sqliteTable("invoice_collection_closures",{
 invoice_id:text("invoice_id").primaryKey().notNull(),
 change_id:text("change_id").notNull(),
 amount:integer("amount").notNull(),
 body:text("body").notNull(),
 status:text("status").notNull().default(sql.raw("'awaiting-merchant'")),
 created:text("created").notNull(),
},table=>[
]);

export const t_invoice_refund_allocations=sqliteTable('invoice_refund_allocations',{
 request_id:text('request_id').notNull().references(()=>t_invoice_refund_requests.id),
 refund_id:text('refund_id').notNull().references(()=>t_invoice_refunds.refund_id),
 amount:integer('amount').notNull(),created:text('created').notNull(),
},table=>[primaryKey({columns:[table.request_id,table.refund_id]}),index('invoice_refund_allocations_refund').on(table.refund_id),check('invoice_refund_allocation_amount_valid',sql`${table.amount}>0`)]);

export const t_external_recovery_resolutions=sqliteTable('external_recovery_resolutions',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),plan_id:text('plan_id').notNull(),item_id:text('item_id').notNull(),
 body:text('body').notNull(),status:text('status').notNull().default('review'),created:text('created').notNull(),created_by:text('created_by').notNull(),applied_at:text('applied_at'),
},table=>[foreignKey({columns:[table.owner,table.plan_id],foreignColumns:[t_plans.owner,t_plans.id]}),index('external_recovery_resolutions_scope').on(table.owner,table.plan_id,table.created),check('external_recovery_status_valid',sql`${table.status} IN ('review','completed','cancelled')`)]);

export const t_external_recovery_approvals=sqliteTable('external_recovery_approvals',{
 resolution_id:text('resolution_id').notNull().references(()=>t_external_recovery_resolutions.id),member_id:text('member_id').notNull(),approved_at:text('approved_at').notNull(),
},table=>[primaryKey({columns:[table.resolution_id,table.member_id]})]);

export * from './notification-delivery-schema';
export * from './ops-schema';
export * from './frontend-schema';

export const t_bedrock_operations=sqliteTable('bedrock_operations',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),member_id:text('member_id').notNull(),plan_id:text('plan_id'),
 feature:text('feature').notNull(),configuration_hash:text('configuration_hash').notNull(),state:text('state').notNull(),
 started_at:integer('started_at').notNull(),expires_at:integer('expires_at').notNull(),completed_at:integer('completed_at'),error_code:text('error_code'),
},table=>[
 index('bedrock_operations_scope').on(table.owner,table.plan_id,table.configuration_hash,table.started_at),
 index('bedrock_operations_expiry').on(table.state,table.expires_at),
 check('bedrock_operation_feature_valid',sql`${table.feature} IN ('chat','agent','plan-draft','receipt-image','receipt-pdf','diagnostic')`),
 check('bedrock_operation_hash_valid',sql`length(${table.configuration_hash})=64 AND ${table.configuration_hash} NOT GLOB '*[^0-9a-f]*'`),
 check('bedrock_operation_state_valid',sql`${table.state} IN ('running','succeeded','failed','abandoned')`),
 check('bedrock_operation_time_valid',sql`${table.started_at}>=0 AND ${table.expires_at}>${table.started_at} AND (${table.completed_at} IS NULL OR ${table.completed_at}>=${table.started_at})`),
]);
export const t_bedrock_invocations=sqliteTable('bedrock_invocations',{
 id:text('id').primaryKey().notNull(),operation_id:text('operation_id').notNull().references(()=>t_bedrock_operations.id),state:text('state').notNull(),
 started_at:integer('started_at').notNull(),expires_at:integer('expires_at').notNull(),completed_at:integer('completed_at'),reserved_tokens:integer('reserved_tokens').notNull(),
 input_tokens:integer('input_tokens'),output_tokens:integer('output_tokens'),total_tokens:integer('total_tokens'),estimated_cost_usd:real('estimated_cost_usd'),pricing_basis:text('pricing_basis'),
 latency_ms:integer('latency_ms'),error_code:text('error_code'),diagnostic:text('diagnostic'),
},table=>[
 index('bedrock_invocations_window').on(table.started_at),index('bedrock_invocations_operation').on(table.operation_id),index('bedrock_invocations_expiry').on(table.state,table.expires_at),
 check('bedrock_invocation_state_valid',sql`${table.state} IN ('running','succeeded','failed','abandoned')`),
 check('bedrock_invocation_reservation_valid',sql`${table.reserved_tokens}>0`),
 check('bedrock_invocation_time_valid',sql`${table.started_at}>=0 AND ${table.expires_at}>${table.started_at} AND (${table.completed_at} IS NULL OR ${table.completed_at}>=${table.started_at})`),
 check('bedrock_invocation_usage_valid',sql`(${table.input_tokens} IS NULL AND ${table.output_tokens} IS NULL AND ${table.total_tokens} IS NULL AND ${table.estimated_cost_usd} IS NULL) OR (${table.input_tokens} IS NOT NULL AND ${table.output_tokens} IS NOT NULL AND ${table.total_tokens} IS NOT NULL AND ${table.input_tokens}>=0 AND ${table.output_tokens}>=0 AND ${table.total_tokens}=${table.input_tokens}+${table.output_tokens} AND ${table.total_tokens}<=1000000 AND (${table.estimated_cost_usd} IS NULL OR ${table.estimated_cost_usd}>=0))`),
 check('bedrock_invocation_latency_valid',sql`${table.latency_ms} IS NULL OR (${table.latency_ms}>=0 AND ${table.latency_ms}<=300000)`),
]);
export const t_bedrock_workflow_evidence=sqliteTable('bedrock_workflow_evidence',{
 id:text('id').primaryKey().notNull(),operation_id:text('operation_id').notNull().references(()=>t_bedrock_operations.id),owner:text('owner').notNull(),
 member_id:text('member_id').notNull(),plan_id:text('plan_id').notNull(),feature:text('feature').notNull(),configuration_hash:text('configuration_hash').notNull(),
 scope:text('scope').notNull(),reference_hash:text('reference_hash').notNull(),created_at:integer('created_at').notNull(),
},table=>[
 unique('bedrock_workflow_evidence_operation_scope').on(table.operation_id,table.scope),index('bedrock_workflow_evidence_scope').on(table.owner,table.plan_id,table.configuration_hash,table.feature,table.created_at),
 check('bedrock_evidence_feature_valid',sql`${table.feature} IN ('chat','agent','plan-draft','receipt-image','receipt-pdf')`),
 check('bedrock_evidence_config_hash_valid',sql`length(${table.configuration_hash})=64 AND ${table.configuration_hash} NOT GLOB '*[^0-9a-f]*'`),
 check('bedrock_evidence_reference_hash_valid',sql`length(${table.reference_hash})=64 AND ${table.reference_hash} NOT GLOB '*[^0-9a-f]*'`),
 check('bedrock_evidence_scope_valid',sql`${table.scope} IN ('saved-chat-readback','saved-agent-proposal-readback','draft-preview-constructed','saved-image-receipt-readback','saved-pdf-receipt-readback')`),
 check('bedrock_evidence_time_valid',sql`${table.created_at}>=0`),
]);
