import {sqliteTable,text,integer,primaryKey,uniqueIndex,index,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';

export const financialEvents=sqliteTable('financial_events',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),eventId:text('event_id').notNull(),
 facts:text('facts').notNull(),body:text('body').notNull(),currency:text('currency').notNull(),
 provider:text('provider'),providerId:text('provider_id'),kind:text('kind').notNull(),created:text('created').notNull(),
},table=>[primaryKey({columns:[table.owner,table.planId,table.eventId]}),
 uniqueIndex('financial_provider_effect_unique').on(table.provider,table.providerId,table.kind),
]);
export const financialEventHistory=sqliteTable('financial_event_history',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),
 eventId:text('event_id').notNull(),fingerprint:text('fingerprint').notNull(),status:text('status').notNull(),
 body:text('body').notNull(),recorded:text('recorded').notNull(),
},table=>[uniqueIndex('financial_event_transition_unique').on(table.owner,table.planId,table.eventId,table.fingerprint),
 index('financial_event_history_plan').on(table.owner,table.planId,table.recorded)]);
export const approvalRevisions=sqliteTable('approval_revisions',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),itemId:text('item_id').notNull(),
 revision:integer('revision').notNull(),snapshot:text('snapshot').notNull(),created:text('created').notNull(),
},table=>[primaryKey({columns:[table.owner,table.planId,table.itemId,table.revision]})]);
export const approvalMembers=sqliteTable('approval_members',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),itemId:text('item_id').notNull(),
 revision:integer('revision').notNull(),memberId:text('member_id').notNull(),approvedAt:text('approved_at').notNull(),
},table=>[primaryKey({columns:[table.owner,table.planId,table.itemId,table.revision,table.memberId]})]);
export const paymentFundingClaims=sqliteTable('payment_funding_claims',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),itemId:text('item_id').notNull(),revision:integer('revision').notNull(),
 memberId:text('member_id').notNull(),channel:text('channel').notNull(),referenceId:text('reference_id').notNull(),created:text('created').notNull(),
},table=>[primaryKey({columns:[table.owner,table.planId,table.itemId,table.revision,table.memberId]}),
 check('payment_funding_channel_valid',sql`${table.channel} IN ('order','invoice')`)]);
export const providerRequestIntents=sqliteTable('provider_request_intents',{
 operationId:text('operation_id').primaryKey(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),
 path:text('path').notNull(),method:text('method').notNull(),requestBody:text('request_body').notNull(),
 requestKey:text('request_key').notNull(),fingerprint:text('fingerprint').notNull(),
 created:text('created').notNull(),replayBefore:text('replay_before').notNull(),
},table=>[index('provider_intents_owner').on(table.owner)]);
