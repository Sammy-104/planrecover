import { bedrockConfig, BedrockError, BEDROCK_ERROR_CODES, safeBedrockDiagnostic,
  type BedrockObserver, type BedrockErrorCode } from './bedrock.ts';

export const BEDROCK_FEATURES = ['chat','agent','plan-draft','receipt-image','receipt-pdf','diagnostic'] as const;
export type BedrockFeature = typeof BEDROCK_FEATURES[number];
type Context = { owner: string; memberId: string; planId?: string; feature: BedrockFeature };
type Database = Pick<D1Database, 'prepare'>;
type Controls = { requestsPerMinute: number; tokensPerMinute: number; dailyTokenLimit: number | null;
  inputUsdPerMillionTokens: number | null; outputUsdPerMillionTokens: number | null };
export type BedrockFeatureOperations = { attempted: number; succeeded: number; failed: number; running: number; abandoned: number;
  lastSucceededAt: string | null; lastAttemptAt: string | null; knownTokens: number; unknownUsageInvocations: number;
  estimatedCostUsd: number | null; lastErrorCode: BedrockErrorCode | null };
export type BedrockOperationsSummary = {
  scope: 'validated-provider-workflow'; window: 'last-24-hours'; since: string;
  operationLimit: 1000; truncated: boolean;
  controls: { requestsPerMinute: number; tokensPerMinute: number; dailyTokenLimit: number | null;
    reservationIsEstimate: true; pricingConfigured: boolean; dailyWindow: 'UTC' };
  features: Record<BedrockFeature, BedrockFeatureOperations>;
  recent: { feature: BedrockFeature; state: 'running'|'succeeded'|'failed'|'abandoned'; startedAt: string; completedAt: string|null;
    errorCode: BedrockErrorCode|null }[];
};

const configFailure = () => new BedrockError('BEDROCK_CONFIG', 'The shared AI limits or explicit pricing settings are invalid.', 503);
const accountingFailure = () => new BedrockError('BEDROCK_ACCOUNTING', 'AI usage could not be recorded safely. Check service status before retrying.', 503);
function integer(value: unknown, fallback: number | null, min: number, max: number) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') throw configFailure();
  if (typeof value === 'string' && !/^\d+$/.test(value)) throw configFailure();
  const result = Number(value); if (!Number.isSafeInteger(result) || result < min || result > max) throw configFailure(); return result;
}
function price(value: unknown) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw configFailure();
  if (typeof value === 'string' && !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) throw configFailure();
  const result = Number(value); if (!Number.isFinite(result) || result < 0 || result > 100_000) throw configFailure(); return result;
}
export function bedrockSharedControls(settings: Record<string, unknown>): Controls {
  const input = price(settings.BEDROCK_INPUT_USD_PER_MILLION_TOKENS), output = price(settings.BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS);
  if ((input === null) !== (output === null)) throw configFailure();
  return { requestsPerMinute: integer(settings.BEDROCK_SHARED_REQUESTS_PER_MINUTE,20,1,120)!,
    tokensPerMinute: integer(settings.BEDROCK_SHARED_TOKENS_PER_MINUTE,400_000,128,10_000_000)!,
    dailyTokenLimit: integer(settings.BEDROCK_DAILY_TOKEN_LIMIT,null,128,100_000_000),
    inputUsdPerMillionTokens: input, outputUsdPerMillionTokens: output };
}
/** Exact configuration fingerprint only; never return it through a public API. */
export async function bedrockConfigurationHash(settings: Record<string, unknown>) {
  const configuration = bedrockConfig(settings); if (!configuration) throw configFailure();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: 1, configuration,
    controls: bedrockSharedControls(settings) })));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
}
function code(value: unknown): BedrockErrorCode | null {
  return typeof value === 'string' && BEDROCK_ERROR_CODES.some(item => item === value) ? value as BedrockErrorCode : null;
}
function validContext(context: Context) {
  if (!context || !BEDROCK_FEATURES.includes(context.feature) || [context.owner, context.memberId].some(value => typeof value !== 'string' || !value || value.length > 256)
    || (context.planId !== undefined && (typeof context.planId !== 'string' || !context.planId || context.planId.length > 256))) throw configFailure();
}
async function databaseWork<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) { if (error instanceof BedrockError) throw error; throw accountingFailure(); }
}
function checked(result: D1Result) { if (!result.success) throw accountingFailure(); return result; }
async function abandonExpired(database: Database, now: number) {
  await databaseWork(async () => {
    checked(await database.prepare("UPDATE bedrock_invocations SET state='abandoned',completed_at=expires_at,error_code='BEDROCK_TIMEOUT' WHERE state='running' AND expires_at<=?").bind(now).run());
    checked(await database.prepare("UPDATE bedrock_operations SET state='abandoned',completed_at=expires_at,error_code='BEDROCK_TIMEOUT' WHERE state='running' AND expires_at<=?").bind(now).run());
  });
}

/** Global, atomic admission applies to every provider HTTP round, across members and profiles. */
export async function withTrackedBedrock<T>(database: Database, settings: Record<string,unknown>, context: Context,
  work: (observer: BedrockObserver & { readonly operationId: string; readonly configurationHash: string }) => Promise<T>): Promise<T> {
  validContext(context); const configurationHash = await bedrockConfigurationHash(settings), controls = bedrockSharedControls(settings);
  const operationId = crypto.randomUUID(), started = Date.now();
  await abandonExpired(database, started);
  await databaseWork(async () => checked(await database.prepare(`INSERT INTO bedrock_operations
    (id,owner,member_id,plan_id,feature,configuration_hash,state,started_at,expires_at) VALUES (?,?,?,?,?,?,'running',?,?)`)
    .bind(operationId,context.owner,context.memberId,context.planId??null,context.feature,configurationHash,started,started+120_000).run()));
  const invocations = new Set<string>();
  const observer: BedrockObserver & { operationId: string; configurationHash: string } = { operationId, configurationHash,
    async beforeInvocation(reservation) {
      if (!Number.isSafeInteger(reservation.estimatedInputTokens) || reservation.estimatedInputTokens < 1 || reservation.estimatedInputTokens > 10_000_000
        || !Number.isSafeInteger(reservation.maxOutputTokens) || reservation.maxOutputTokens < 1 || reservation.maxOutputTokens > 4096
        || !Number.isFinite(reservation.timeoutMs) || reservation.timeoutMs < 1 || reservation.timeoutMs > 45_000) throw configFailure();
      const now = Date.now(), day = Math.floor(now/86_400_000)*86_400_000, id = crypto.randomUUID();
      const reserved = reservation.estimatedInputTokens + reservation.maxOutputTokens;
      const row = await databaseWork(() => database.prepare(`INSERT INTO bedrock_invocations
        (id,operation_id,state,started_at,expires_at,reserved_tokens) SELECT ?,?,'running',?,?,?
        WHERE EXISTS(SELECT 1 FROM bedrock_operations WHERE id=? AND state='running' AND expires_at>?)
        AND (SELECT count(*) FROM bedrock_invocations WHERE started_at>?)<?
        AND COALESCE((SELECT sum(COALESCE(total_tokens,reserved_tokens)) FROM bedrock_invocations WHERE started_at>?),0)+?<=?
        AND (? IS NULL OR COALESCE((SELECT sum(COALESCE(total_tokens,reserved_tokens)) FROM bedrock_invocations WHERE started_at>=?),0)+?<=?)
        RETURNING id`).bind(id,operationId,now,now+reservation.timeoutMs+1000,reserved,operationId,now,now-60_000,controls.requestsPerMinute,
          now-60_000,reserved,controls.tokensPerMinute,controls.dailyTokenLimit,day,reserved,controls.dailyTokenLimit).first<{id:string}>());
      if (!row) {
        const daily = controls.dailyTokenLimit === null ? null : await databaseWork(() => database.prepare(`SELECT COALESCE(sum(COALESCE(total_tokens,reserved_tokens)),0) AS tokens FROM bedrock_invocations WHERE started_at>=?`).bind(day).first<{tokens:number}>());
        if (daily && daily.tokens+reserved>controls.dailyTokenLimit!) throw new BedrockError('BEDROCK_DAILY_LIMIT','The shared daily AI token allowance was reached. Ask the owner to review usage.',429);
        throw new BedrockError('BEDROCK_SHARED_LIMIT','The shared AI request or token allowance is busy. Try again after a minute.',429,true);
      }
      invocations.add(id); return id;
    },
    async recordUsage(id, usage) {
      if (!invocations.has(id) || ![usage.inputTokens,usage.outputTokens,usage.totalTokens].every(value => Number.isSafeInteger(value) && value>=0)
        || usage.totalTokens!==usage.inputTokens+usage.outputTokens || usage.totalTokens>1_000_000) throw accountingFailure();
      const cost = controls.inputUsdPerMillionTokens===null ? null : (usage.inputTokens*controls.inputUsdPerMillionTokens+usage.outputTokens*controls.outputUsdPerMillionTokens!)/1_000_000;
      const row = await databaseWork(() => database.prepare(`UPDATE bedrock_invocations SET input_tokens=?,output_tokens=?,total_tokens=?,estimated_cost_usd=?
        WHERE id=? AND operation_id=? AND total_tokens IS NULL RETURNING id`).bind(usage.inputTokens,usage.outputTokens,usage.totalTokens,cost,id,operationId).first<{id:string}>());
      if (!row) throw accountingFailure();
    },
    async afterInvocation(id, result) {
      if (!invocations.has(id) || !['succeeded','failed'].includes(result.outcome) || !Number.isFinite(result.latencyMs)) throw accountingFailure();
      const diagnostic = safeBedrockDiagnostic(result.diagnostic), now = Date.now();
      await databaseWork(async () => checked(await database.prepare(`UPDATE bedrock_invocations SET state=?,completed_at=?,latency_ms=?,error_code=?,diagnostic=?
        WHERE id=? AND operation_id=? AND state='running'`).bind(result.outcome,now,Math.min(300_000,Math.max(0,Math.round(result.latencyMs))),
          code(result.errorCode),diagnostic?JSON.stringify(diagnostic):null,id,operationId).run()));
    },
  };
  try {
    const value = await work(observer), now = Date.now();
    const complete = await databaseWork(() => database.prepare(`UPDATE bedrock_operations SET state='succeeded',completed_at=?
      WHERE id=? AND state='running' AND expires_at>? AND EXISTS(SELECT 1 FROM bedrock_invocations WHERE operation_id=?)
      AND NOT EXISTS(SELECT 1 FROM bedrock_invocations WHERE operation_id=? AND state<>'succeeded') RETURNING id`)
      .bind(now,operationId,now,operationId,operationId).first<{id:string}>());
    if (!complete) throw accountingFailure(); return value;
  } catch (error) {
    await databaseWork(async () => checked(await database.prepare(`UPDATE bedrock_operations SET state='failed',completed_at=?,error_code=? WHERE id=? AND state='running'`)
      .bind(Date.now(),error instanceof BedrockError?code(error.code):'BEDROCK_UNAVAILABLE',operationId).run()));
    throw error;
  }
}

/** Owner/plan-scoped facts; successful transport never certifies review or approval. */
export async function readBedrockOperationsSummary(database: Database, settings: Record<string,unknown>, owner: string, planId?: string,
  now = Date.now()): Promise<BedrockOperationsSummary> {
  validContext({owner,memberId:owner,planId,feature:'diagnostic'});
  const configurationHash = await bedrockConfigurationHash(settings), controls = bedrockSharedControls(settings), since = now-86_400_000;
  await abandonExpired(database,now);
  const rows = await databaseWork(() => database.prepare(`SELECT o.feature,o.state,o.started_at,o.completed_at,o.error_code,
    (SELECT COALESCE(sum(i.total_tokens),0) FROM bedrock_invocations i WHERE i.operation_id=o.id) AS tokens,
    (SELECT count(*) FROM bedrock_invocations i WHERE i.operation_id=o.id AND i.total_tokens IS NULL) AS unknown_usage,
    (SELECT sum(i.estimated_cost_usd) FROM bedrock_invocations i WHERE i.operation_id=o.id) AS cost
    FROM bedrock_operations o WHERE owner=? AND (? IS NULL OR plan_id=?) AND configuration_hash=? AND started_at>=?
    ORDER BY started_at DESC LIMIT 1001`).bind(owner,planId??null,planId??null,configurationHash,since).all<{
      feature:BedrockFeature;state:'running'|'succeeded'|'failed'|'abandoned';started_at:number;completed_at:number|null;
      error_code:string|null;tokens:number;unknown_usage:number;cost:number|null}>());
  if (!rows.success) throw accountingFailure();
  const features = Object.fromEntries(BEDROCK_FEATURES.map(feature => [feature,{attempted:0,succeeded:0,failed:0,running:0,abandoned:0,
    lastSucceededAt:null,lastAttemptAt:null,knownTokens:0,unknownUsageInvocations:0,estimatedCostUsd:controls.inputUsdPerMillionTokens===null?null:0,lastErrorCode:null}])) as Record<BedrockFeature,BedrockFeatureOperations>;
  for (const row of rows.results.slice(0,1000)) {
    if (!BEDROCK_FEATURES.includes(row.feature)) continue; const feature = features[row.feature];
    feature.attempted++; feature[row.state]++; feature.lastAttemptAt??=new Date(row.started_at).toISOString();
    if (row.state==='succeeded') feature.lastSucceededAt??=new Date(row.completed_at??row.started_at).toISOString();
    feature.lastErrorCode??=code(row.error_code); feature.knownTokens+=row.tokens; feature.unknownUsageInvocations+=row.unknown_usage;
    if (feature.estimatedCostUsd!==null) feature.estimatedCostUsd = row.unknown_usage ? null : feature.estimatedCostUsd+(row.cost??0);
  }
  return {scope:'validated-provider-workflow',window:'last-24-hours',since:new Date(since).toISOString(),operationLimit:1000,truncated:rows.results.length>1000,
    controls:{requestsPerMinute:controls.requestsPerMinute,tokensPerMinute:controls.tokensPerMinute,dailyTokenLimit:controls.dailyTokenLimit,
      reservationIsEstimate:true,pricingConfigured:controls.inputUsdPerMillionTokens!==null,dailyWindow:'UTC'},features,
    recent:rows.results.slice(0,20).map(row=>({feature:row.feature,state:row.state,startedAt:new Date(row.started_at).toISOString(),
      completedAt:row.completed_at===null?null:new Date(row.completed_at).toISOString(),errorCode:code(row.error_code)}))};
}
