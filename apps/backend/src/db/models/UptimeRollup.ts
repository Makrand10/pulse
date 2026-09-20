import { Schema, model, type InferSchemaType } from 'mongoose';

// One document per (apiId, hourly window). Written by the Temporal cron
// aggregation (§6.4) so dashboard uptime % is a cheap rollup read, never a
// scan of raw CheckResult rows.
const ROLLUP_TTL_SECONDS = 45 * 24 * 60 * 60; // 45-day retention (>= raw 30-day TTL)

export const uptimeRollupSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    apiId: { type: Schema.Types.ObjectId, ref: 'Api', required: true, index: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    totalChecks: { type: Number, required: true, min: 0 },
    downChecks: { type: Number, required: true, min: 0 },
    degradedChecks: { type: Number, required: true, min: 0 },
    uptimePct: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true },
);

uptimeRollupSchema.index({ apiId: 1, windowStart: -1 }, { unique: true });
uptimeRollupSchema.index({ windowStart: 1 }, { expireAfterSeconds: ROLLUP_TTL_SECONDS });

export type UptimeRollupDoc = InferSchemaType<typeof uptimeRollupSchema>;

export const UptimeRollup = model('UptimeRollup', uptimeRollupSchema);