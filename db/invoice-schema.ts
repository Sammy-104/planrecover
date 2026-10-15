import {sqliteTable,text,integer,index,foreignKey,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
import {plans} from './schema';

/** Terms are immutable: changed terms require a newly approved item revision. */
export const planInvoices=sqliteTable('plan_invoices',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),planId:text('plan_id').notNull(),
 itemId:text('item_id').notNull(),memberId:text('member_id').notNull(),revision:integer('revision').notNull(),
 requestId:text('request_id').notNull(),terms:text('terms').notNull(),approvedMembers:text('approved_members').notNull().default('[]'),amount:integer('amount').notNull(),
 minimum:integer('minimum').notNull(),paid:integer('paid').notNull().default(0),
 providerId:text('provider_id').unique(),providerUrl:text('provider_url'),status:text('status').notNull(),providerStatus:text('provider_status'),
 version:integer('version').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),
 leaseToken:text('lease_token'),lastError:text('last_error'),created:text('created').notNull(),updated:text('updated').notNull(),
},table=>[
 foreignKey({columns:[table.owner,table.planId],foreignColumns:[plans.owner,plans.id]}),
 index('plan_invoices_scope').on(table.owner,table.planId,table.memberId),
 index('plan_invoices_pending').on(table.status,table.updated),
 check('plan_invoice_amounts_valid',sql`${table.amount}>0 AND ${table.minimum}>0 AND ${table.minimum}<=${table.amount} AND ${table.paid}>=0 AND ${table.paid}<=${table.amount}`),
 check('plan_invoice_version_valid',sql`${table.version}>=0 AND ${table.revision}>0`),
 check('plan_invoice_status_valid',sql`${table.status} IN ('creating','draft','sending','sent','partially-paid','paid','cancelling','cancelled','needs-review')`),
]);
export const planInvoicePayments=sqliteTable('plan_invoice_payments',{
 id:text('id').primaryKey(),invoiceId:text('invoice_id').notNull().references(()=>planInvoices.id),
 owner:text('owner').notNull(),planId:text('plan_id').notNull(),amount:integer('amount').notNull(),
 body:text('body').notNull(),created:text('created').notNull(),
},table=>[index('plan_invoice_payments_invoice').on(table.invoiceId),check('plan_invoice_payment_positive',sql`${table.amount}>0`)]);
