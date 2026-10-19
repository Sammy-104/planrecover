import {sqliteTable,text,integer,index,primaryKey,uniqueIndex,check,foreignKey} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
import {planMembers} from './schema';
import {adapterOperations} from './expansion-schema';
import {reminderJobs} from './planning-schema';

export const notificationDeliveryEvents=sqliteTable('notification_delivery_events',{
 id:text('id').primaryKey().notNull(),attemptId:text('attempt_id').notNull().references(()=>adapterOperations.id),owner:text('owner').notNull(),planId:text('plan_id').notNull(),memberId:text('member_id').notNull(),providerMessageId:text('provider_message_id').notNull(),eventType:text('event_type').notNull(),occurredAt:text('occurred_at').notNull(),receivedAt:text('received_at').notNull(),digest:text('digest').notNull(),reason:text('reason').notNull(),
},t=>[index('notification_delivery_events_scope').on(t.owner,t.planId,t.memberId,t.receivedAt),index('notification_delivery_events_attempt').on(t.attemptId,t.eventType),check('notification_event_type_valid',sql`${t.eventType} IN ('delivery','bounce','complaint','delay','rejected')`)]);
export const notificationSuppressions=sqliteTable('notification_suppressions',{
 owner:text('owner').notNull(),destinationHash:text('destination_hash').notNull(),reason:text('reason').notNull(),suppressedUntil:integer('suppressed_until'),eventId:text('event_id').notNull().references(()=>notificationDeliveryEvents.id),updated:text('updated').notNull(),
},t=>[primaryKey({columns:[t.owner,t.destinationHash]}),check('notification_suppression_reason_valid',sql`${t.reason} IN ('hard-bounce','soft-bounce','complaint')`)]);
export const webPushSubscriptions=sqliteTable('web_push_subscriptions',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),memberId:text('member_id').notNull(),endpointHash:text('endpoint_hash').notNull().unique(),subscription:text('subscription').notNull(),version:integer('version').notNull().default(1),status:text('status').notNull(),expiresAt:integer('expires_at'),created:text('created').notNull(),updated:text('updated').notNull(),
},t=>[index('web_push_subscriptions_member').on(t.owner,t.planId,t.memberId,t.status),foreignKey({columns:[t.owner,t.planId,t.memberId],foreignColumns:[planMembers.owner,planMembers.planId,planMembers.memberId]}),check('web_push_subscription_version_valid',sql`${t.version}>=1`),check('web_push_subscription_status_valid',sql`${t.status} IN ('active','revoked','expired')`)]);
export const webPushAttempts=sqliteTable('web_push_attempts',{
 id:text('id').primaryKey().notNull(),jobId:text('job_id').notNull().references(()=>reminderJobs.id),subscriptionId:text('subscription_id').notNull().references(()=>webPushSubscriptions.id),subscriptionVersion:integer('subscription_version').notNull(),status:text('status').notNull(),reason:text('reason').notNull(),created:text('created').notNull(),updated:text('updated').notNull(),
},t=>[uniqueIndex('web_push_attempts_job_subscription').on(t.jobId,t.subscriptionId),check('web_push_attempt_status_valid',sql`${t.status} IN ('sending','accepted','rejected','expired','uncertain','cancelled')`)]);
