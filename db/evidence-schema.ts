import {sqliteTable,text,integer,primaryKey,foreignKey,index,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
import {plans} from './schema';

/** Source facts confirmed by the plan owner; never personal member preferences. */
export const planningEvidence=sqliteTable('planning_evidence',{
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),kind:text('kind').notNull(),subjectKey:text('subject_key').notNull(),
 body:text('body').notNull(),subjectSnapshot:text('subject_snapshot').notNull(),sourceUrl:text('source_url').notNull(),checkedAt:text('checked_at').notNull(),
 confirmedBy:text('confirmed_by').notNull(),status:text('status').notNull().default('active'),version:integer('version').notNull().default(1),created:text('created').notNull(),updated:text('updated').notNull(),
},table=>[
 primaryKey({columns:[table.owner,table.planId,table.kind,table.subjectKey]}),
 foreignKey({columns:[table.owner,table.planId],foreignColumns:[plans.owner,plans.id]}),
 index('planning_evidence_plan').on(table.owner,table.planId,table.kind),
 check('planning_evidence_kind_valid',sql`${table.kind} IN ('supplier','travel')`),
 check('planning_evidence_version_valid',sql`${table.version}>0`),
 check('planning_evidence_status_valid',sql`${table.status} IN ('active','revoked')`),
]);
