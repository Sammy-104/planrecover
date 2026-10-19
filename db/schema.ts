import { sqliteTable, text, integer, index, primaryKey, check, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export * from './financial-schema';
export * from './recovery-schema';
export * from './invoice-schema';
export * from './planning-schema';
export * from './jobs-schema';
export * from './evidence-schema';
export * from './expansion-schema';
export * from './notification-delivery-schema';
export * from './ops-schema';
export * from './frontend-schema';
export const workspaces=sqliteTable('workspaces',{owner:text('owner').primaryKey(),body:text('body').notNull(),version:integer('version').notNull().default(0),updated:text('updated').notNull()});
export const providerOperations=sqliteTable('provider_operations',{id:text('id').primaryKey(),owner:text('owner').notNull(),itemId:text('item_id').notNull(),member:text('member').notNull(),revision:integer('revision').notNull(),kind:text('kind').notNull(),amount:integer('amount').notNull(),providerId:text('provider_id'),status:text('status').notNull(),payload:text('payload')},table=>[index('idx_provider_operations_provider_kind').on(table.providerId,table.kind)]);
export const webhookEvents=sqliteTable('webhook_events',{
 id:text('id').primaryKey(),body:text('body').notNull(),received:text('received').notNull(),
 status:text('status').notNull().default('received'),attempts:integer('attempts').notNull().default(0),
 processingStarted:text('processing_started'),lastError:text('last_error'),processed:text('processed'),
});
export const routeProviderSlots=sqliteTable('route_provider_slots',{id:text('id').primaryKey(),nextAt:integer('next_at').notNull()});
export const tripLinks=sqliteTable('trip_links',{tokenHash:text('token_hash').primaryKey(),token:text('token').notNull(),owner:text('owner').notNull(),tripId:text('trip_id').notNull(),role:text('role').notNull().default('editor'),created:text('created').notNull(),expires:text('expires')},table=>[index('idx_trip_links_owner_trip').on(table.owner,table.tripId)]);

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(), displayName: text('display_name').notNull(), updated: text('updated').notNull(),
});
export const plans = sqliteTable('plans', {
  owner: text('owner').notNull(), id: text('id').notNull(), name: text('name').notNull(),
  body: text('body').notNull(), version: integer('version').notNull().default(0),
  status: text('status').notNull(), ordinal: integer('ordinal').notNull().default(0),
  updated: text('updated').notNull(),
}, table => [primaryKey({columns:[table.owner,table.id]}),
  check('plans_version_nonnegative', sql`${table.version} >= 0`),
  check('plans_status_valid', sql`${table.status} IN ('active','archived','deleted')`),
  index('plans_owner_status').on(table.owner, table.status)]);
export const planMembers = sqliteTable('plan_members', {
  owner: text('owner').notNull(), planId: text('plan_id').notNull(), memberId: text('member_id').notNull(),
  role: text('role').notNull(), body: text('body').notNull(),
}, table => [primaryKey({columns:[table.owner,table.planId,table.memberId]}),
  foreignKey({columns:[table.owner,table.planId],foreignColumns:[plans.owner,plans.id]}),
  check('plan_members_role_valid', sql`${table.role} IN ('owner','editor','viewer','legacy')`),
  index('plan_members_identity').on(table.memberId)]);
export const memberPreferences = sqliteTable('member_preferences', {
  owner: text('owner').notNull(), planId: text('plan_id').notNull(), memberId: text('member_id').notNull(),
  body: text('body').notNull(), version: integer('version').notNull().default(0), updated: text('updated').notNull(),
}, table => [primaryKey({columns:[table.owner,table.planId,table.memberId]}),
  foreignKey({columns:[table.owner,table.planId,table.memberId],foreignColumns:[planMembers.owner,planMembers.planId,planMembers.memberId]}),
  check('preferences_version_nonnegative', sql`${table.version} >= 0`)]);
// A failed optimistic check must abort the entire D1 batch, including its other writes.
export const backendWriteGuards = sqliteTable('backend_write_guards', {
  id: text('id').primaryKey(), valid: integer('valid').notNull(),
}, table => [check('backend_write_guard_valid', sql`${table.valid} = 1`)]);

export const providerReconciliationAttempts = sqliteTable('provider_reconciliation_attempts', {
  operationId: text('operation_id').primaryKey().references(() => providerOperations.id),
  owner: text('owner').notNull(), status: text('status').notNull().default('ready'),
  attempts: integer('attempts').notNull().default(0), processingStarted: text('processing_started'),
  lastAttempt: text('last_attempt'), lastError: text('last_error'), completed: text('completed'),
}, table => [check('provider_reconciliation_attempts_nonnegative', sql`${table.attempts} >= 0`),
  index('idx_provider_reconciliation_owner_attempt').on(table.owner, table.lastAttempt)]);

export const receiptDrafts = sqliteTable('receipt_drafts', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),
 uploadedBy:text('uploaded_by').notNull(),fileKey:text('file_key').notNull().unique(),
 mime:text('mime').notNull(),size:integer('size').notNull(),status:text('status').notNull(),
 version:integer('version').notNull().default(0),sourceFacts:text('source_facts'),
 unknownFields:text('unknown_fields').notNull(),warnings:text('warnings').notNull(),
 reviewedReceipt:text('reviewed_receipt'),provider:text('provider'),modelId:text('model_id'),
 created:text('created').notNull(),updated:text('updated').notNull(),
}, table=>[
 foreignKey({columns:[table.owner,table.planId],foreignColumns:[plans.owner,plans.id]}),
 index('receipt_drafts_plan_updated').on(table.owner,table.planId,table.updated),
 check('receipt_drafts_status_valid',sql`${table.status} IN ('uploaded','extracting','review-required','failed','reviewed')`),
 check('receipt_drafts_version_valid',sql`${table.version} >= 0`),
 check('receipt_drafts_size_valid',sql`${table.size} > 0 AND ${table.size} <= 8388608`),
]);

export const aiUsageLimits=sqliteTable('ai_usage_limits',{
 memberId:text('member_id').notNull(),feature:text('feature').notNull(),
 windowStart:integer('window_start').notNull(),requestCount:integer('request_count').notNull(),
 leaseUntil:integer('lease_until').notNull(),leaseToken:text('lease_token'),
},table=>[primaryKey({columns:[table.memberId,table.feature]}),
 check('ai_usage_feature_valid',sql`${table.feature} IN ('plan-draft','receipt-extraction')`),
 check('ai_usage_count_valid',sql`${table.requestCount} >= 1 AND ${table.requestCount} <= 20`),
]);
