import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const apiSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true },
    url: { type: String, required: true },
    method: { type: String, enum: ['GET', 'POST', 'HEAD'], default: 'GET' },
    expectedStatus: { type: Number, required: true, default: 200 },
    latencyThresholdMs: { type: Number, required: true, default: 1000 },
    intervalSeconds: { type: Number, required: true, min: 30, max: 86400, default: 60 },
    headers: { type: Map, of: String, default: undefined },
    authTokenEncrypted: { type: String }, // AES-256-GCM blob; plaintext never persisted
    body: { type: String },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: false },
    alertUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

// Unique per team, but only for rows that actually carry a slug (legacy rows
// are backfilled by ensureSlugs(); test fixtures may omit it).
apiSchema.index(
  { teamId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);

export type ApiDoc = HydratedDocument<InferSchemaType<typeof apiSchema>>;

export const Api = model('Api', apiSchema);