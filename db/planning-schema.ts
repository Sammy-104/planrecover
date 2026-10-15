import {sqliteTable,text,integer,index,primaryKey,foreignKey,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
import {plans,planMembers} from './schema';

/** Private member inputs are deliberately separate from the shared plan body. */
export const memberPlanningPreferences=sqliteTable('member_planning_preferences',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),memberId:text('member_id').notNull(),
 body:text('body').notNull(),version:integer('version').notNull().default(0),updated:text('updated').notNull(),
},table=>[
 primaryKey({columns:[table.owner,table.planId,table.memberId]}),
 foreignKey({columns:[table.owner,table.planId,table.memberId],foreignColumns:[planMembers.owner,planMembers.planId,planMembers.memberId]}),
 check('planning_preferences_version_valid',sql`${table.version}>=0`),
]);

export const reminderJobs=sqliteTable('reminder_jobs',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),memberId:text('member_id').notNull(),
 sourceKind:text('source_kind').notNull(),sourceId:text('source_id').notNull(),sourceDueAt:integer('source_due_at').notNull(),
 title:text('title').notNull(),body:text('body').notNull(),timezone:text('timezone').notNull(),
 leadMinutes:integer('lead_minutes').notNull(),channel:text('channel').notNull(),dueAt:integer('due_at').notNull(),
 planVersion:integer('plan_version').notNull(),preferencesVersion:integer('preferences_version').notNull(),
 invoiceVersion:integer('invoice_version').notNull().default(-1),status:text('status').notNull().default('scheduled'),
 attempts:integer('attempts').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),leaseToken:text('lease_token'),
 lastError:text('last_error'),created:text('created').notNull(),updated:text('updated').notNull(),delivered:text('delivered'),
},table=>[
 foreignKey({columns:[table.owner,table.planId,table.memberId],foreignColumns:[planMembers.owner,planMembers.planId,planMembers.memberId]}),
 index('reminder_jobs_due').on(table.status,table.dueAt,table.leaseUntil),
 index('reminder_jobs_member').on(table.owner,table.planId,table.memberId),
 check('reminder_job_channel_valid',sql`${table.channel} IN ('in-app','email','push')`),
 check('reminder_job_source_valid',sql`${table.sourceKind} IN ('task','item-deadline','reminder','invoice')`),
 check('reminder_job_status_valid',sql`${table.status} IN ('scheduled','processing','delivered','cancelled','unavailable')`),
 check('reminder_job_numbers_valid',sql`${table.attempts}>=0 AND ${table.leadMinutes}>=0 AND ${table.planVersion}>=0 AND ${table.preferencesVersion}>=0`),
]);

export const planNotifications=sqliteTable('plan_notifications',{
 id:text('id').primaryKey(),jobId:text('job_id').notNull().unique().references(()=>reminderJobs.id),
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),memberId:text('member_id').notNull(),
 title:text('title').notNull(),body:text('body').notNull(),created:text('created').notNull(),readAt:text('read_at'),
},table=>[
 foreignKey({columns:[table.owner,table.planId],foreignColumns:[plans.owner,plans.id]}),
 index('plan_notifications_member').on(table.owner,table.planId,table.memberId,table.created),
]);
