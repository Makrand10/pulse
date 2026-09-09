import { Schema, model, type InferSchemaType } from 'mongoose';
import type { CheckStatus } from '@pulse/shared-types';

const CHECK_STATUSES: CheckStatus[] = ['UP', 'DOWN', 'DEGRADED'];
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day retention (PRD §6.4)

export const checkResultSchema = new Schema(
  {
    apiId: { type: Schema.Types.ObjectId, ref: 'Api', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    status: { type: String, enum: CHECK_STATUSES, required: true },
    latencyMs: { type: Number, required: true },
    statusCode: { type: Number },
    errorMessage: { type: String },
    checkedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

checkResultSchema.index({ checkedAt: 1 }, { expireAfterSeconds: TTL_SECONDS });

export type CheckResultDoc = InferSchemaType<typeof checkResultSchema>;

export const CheckResult = model('CheckResult', checkResultSchema);