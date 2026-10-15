import { sqliteTable, text, integer, index, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Source terms and approval snapshots are write-once. Superseding terms require a new policy.
export const bookingPolicies = sqliteTable('booking_policies', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), planId: text('plan_id').notNull(),
  itemId: text('item_id').notNull(), revision: integer('revision').notNull(),
  body: text('body').notNull(), confirmedBy: text('confirmed_by').notNull(), created: text('created').notNull(),
}, table => [index('booking_policies_plan_item').on(table.owner, table.planId, table.itemId)]);

export const recoveryProposals = sqliteTable('recovery_proposals', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), planId: text('plan_id').notNull(),
  policyId: text('policy_id').notNull().references(() => bookingPolicies.id),
  planVersion: integer('plan_version').notNull(), version: integer('version').notNull().default(1),
  status: text('status').notNull(), body: text('body').notNull(), createdBy: text('created_by').notNull(),
  created: text('created').notNull(), updated: text('updated').notNull(),
  executionToken: text('execution_token'), executionUntil: integer('execution_until').notNull().default(0),
}, table => [index('recovery_proposals_plan_updated').on(table.owner, table.planId, table.updated),
  check('recovery_proposal_status_valid', sql`${table.status} IN ('review','executing','completed','manual-review','cancelled')`),
  check('recovery_proposal_version_valid', sql`${table.version} >= 1`)]);

export const recoveryApprovals = sqliteTable('recovery_approvals', {
  proposalId: text('proposal_id').notNull().references(() => recoveryProposals.id),
  version: integer('version').notNull(), memberId: text('member_id').notNull(), approved: text('approved').notNull(),
}, table => [primaryKey({ columns: [table.proposalId, table.version, table.memberId] })]);

export const captureRefundCapacity = sqliteTable('capture_refund_capacity', {
  captureId: text('capture_id').primaryKey(), owner: text('owner').notNull(), planId: text('plan_id').notNull(),
  itemId: text('item_id').notNull(), memberId: text('member_id').notNull(), currency: text('currency').notNull(),
  captured: integer('captured').notNull(), reserved: integer('reserved').notNull().default(0),
  refunded: integer('refunded').notNull().default(0), updated: text('updated').notNull(),
}, table => [check('capture_refund_capacity_valid', sql`${table.captured} > 0 AND ${table.reserved} >= 0 AND ${table.refunded} >= 0 AND ${table.reserved} + ${table.refunded} <= ${table.captured}`),
  index('capture_refund_capacity_plan').on(table.owner, table.planId)]);

export const refundReservations = sqliteTable('refund_reservations', {
  id: text('id').primaryKey(), proposalId: text('proposal_id').notNull().references(() => recoveryProposals.id),
  captureId: text('capture_id').notNull().references(() => captureRefundCapacity.captureId),
  memberId: text('member_id').notNull(), amount: integer('amount').notNull(), currency: text('currency').notNull(),
  status: text('status').notNull(), refundId: text('refund_id'), created: text('created').notNull(), updated: text('updated').notNull(),
}, table => [index('refund_reservations_proposal').on(table.proposalId),
  check('refund_reservation_amount_valid', sql`${table.amount} > 0`),
  check('refund_reservation_status_valid', sql`${table.status} IN ('reserved','submitted','confirmed','failed','manual-review')`)]);

// One claim per provider operation makes legacy backfill and retries idempotent.
export const captureRefundClaims = sqliteTable('capture_refund_claims', {
  id:text('id').primaryKey(),captureId:text('capture_id').notNull().references(()=>captureRefundCapacity.captureId),
  amount:integer('amount').notNull(),status:text('status').notNull(),created:text('created').notNull(),
},table=>[index('capture_refund_claims_capture').on(table.captureId),
  check('capture_refund_claim_amount_valid',sql`${table.amount} > 0`),
  check('capture_refund_claim_status_valid',sql`${table.status} IN ('reserved','confirmed')`)]);
