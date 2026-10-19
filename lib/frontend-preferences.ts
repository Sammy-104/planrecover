import {z} from 'zod';
const minute=z.number().int().min(0).max(43200);
const reminderSettings=z.object({leadMinutes:z.object({task:minute,payment:minute,quote:minute,cancellation:minute,custom:minute}).strict(),browser:z.boolean()}).strict();
export const frontendPreferenceFields={
 travelBuffer:z.number().int().min(0).max(90).optional(),queueMinutes:z.number().int().min(0).max(120).optional(),restMinutes:z.number().int().min(0).max(180).optional(),maxWalkMinutes:z.number().int().min(0).max(180).optional(),
 mobility:z.enum(['any','step-free','short-walks']).optional(),dietary:z.string().max(160).optional(),
 availableFrom:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')).optional(),availableTo:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')).optional(),
 currency:z.string().regex(/^[A-Z]{3}$/).optional(),publicOnly:z.literal(false).optional(),cashLimitSet:z.boolean().optional(),reminders:reminderSettings.optional(),
 reminderState:z.record(z.string().min(1).max(220).refine(k=>!['__proto__','constructor','prototype'].includes(k)),z.object({done:z.boolean().optional(),snoozedUntil:z.string().max(40).refine(v=>Number.isFinite(Date.parse(v))).optional()}).strict()).refine(v=>Object.keys(v).length<=500).optional(),
};
const extras=z.object(frontendPreferenceFields);
export function frontendPrivatePreferences(value:unknown){return extras.parse(value);}
