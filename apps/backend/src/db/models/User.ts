import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    role: { type: String, enum: ['admin', 'manager', 'user', 'member'], default: 'user' },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

export const User = model('User', userSchema);