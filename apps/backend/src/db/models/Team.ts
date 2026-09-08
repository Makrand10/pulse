import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    members: [{ userId: { type: Schema.Types.ObjectId, ref: 'User' }, role: String }],
    inviteTokens: [
      {
        token: { type: String, required: true },
        role: { type: String, enum: ['admin', 'member'], default: 'member' },
        used: { type: Boolean, default: false },
        expiresAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);

export type TeamDoc = HydratedDocument<InferSchemaType<typeof teamSchema>>;

export const Team = model('Team', teamSchema);