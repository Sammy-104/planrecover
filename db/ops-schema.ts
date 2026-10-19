import {sqliteTable,text,integer,primaryKey,index,uniqueIndex,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const opsHealthEpisodes=sqliteTable('ops_health_episodes',{
 owner:text('owner').notNull(),code:text('code').notNull(),generation:integer('generation').notNull().default(1),
 active:integer('active').notNull(),openedAt:integer('opened_at').notNull(),closedAt:integer('closed_at'),observedAt:integer('observed_at').notNull(),
},t=>[primaryKey({columns:[t.owner,t.code]}),check('ops_episode_generation',sql`${t.generation}>=1`),check('ops_episode_active',sql`${t.active} IN (0,1)`)]);
export const opsHealthAlerts=sqliteTable('ops_health_alerts',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),code:text('code').notNull(),generation:integer('generation').notNull(),event:text('event').notNull(),status:text('status').notNull().default('pending'),
 attempts:integer('attempts').notNull().default(0),nextAt:integer('next_at').notNull().default(0),leaseToken:text('lease_token'),leaseUntil:integer('lease_until').notNull().default(0),configurationHash:text('configuration_hash').notNull(),
 created:text('created').notNull(),updated:text('updated').notNull(),acceptedAt:text('accepted_at'),lastOutcome:text('last_outcome'),
},t=>[uniqueIndex('ops_health_alert_episode').on(t.owner,t.code,t.generation,t.event),index('ops_health_alert_due').on(t.owner,t.status,t.nextAt),check('ops_alert_event',sql`${t.event} IN ('opened','recovered')`),check('ops_alert_status',sql`${t.status} IN ('pending','sending','accepted','rejected','uncertain','cancelled')`),check('ops_alert_attempts',sql`${t.attempts}>=0 AND ${t.generation}>=1`)]);
export const backgroundRunEvidence=sqliteTable('background_run_evidence',{
 id:text('id').primaryKey().notNull(),owner:text('owner').notNull(),source:text('source').notNull(),status:text('status').notNull(),startedAt:text('started_at').notNull(),completedAt:text('completed_at'),
},t=>[index('background_evidence_scope').on(t.owner,t.source,t.startedAt),check('background_evidence_source',sql`${t.source} IN ('manual','scheduled')`),check('background_evidence_status',sql`${t.status} IN ('running','completed','failed')`)]);
