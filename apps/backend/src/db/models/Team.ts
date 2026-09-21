import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    // The admin who created the team. Owners may own several "small teams".
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // status: 'invited' until the user accepts, then 'active'. Legacy rows
    // without a status are treated as active.
    members: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        role: { type: String, enum: ['admin', 'manager', 'user', 'member'], default: 'user' },
        status: { type: String, enum: ['invited', 'active'], default: 'active' },
      },
    ],
    inviteTokens: [
      {
        token: { type: String, required: true },
        role: { type: String, enum: ['admin', 'manager', 'user', 'member'], default: 'user' },
        used: { type: Boolean, default: false },
        expiresAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);

export type TeamDoc = HydratedDocument<InferSchemaType<typeof teamSchema>>;

export const Team = model('Team', teamSchema);