import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const backgroundJobRuns=sqliteTable('background_job_runs',{
 owner:text('owner').primaryKey(),leaseToken:text('lease_token'),leaseUntil:integer('lease_until').notNull().default(0),
 nextAt:integer('next_at').notNull().default(0),reminderCursor:text('reminder_cursor'),lastStarted:text('last_started'),lastCompleted:text('last_completed'),
 lastResult:text('last_result'),status:text('status').notNull().default('idle'),
});
