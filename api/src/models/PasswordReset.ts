import mongoose, { Schema, Document } from 'mongoose'

export interface IPasswordReset extends Document {
  userId: mongoose.Types.ObjectId
  email: string
  token: string
  expiresAt: Date
  usedAt?: Date
}

const passwordResetSchema = new Schema<IPasswordReset>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true },
  token: { type: String, required: true, unique: true, index: true },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hora
  },
  usedAt: { type: Date },
}, {
  timestamps: true,
})

export default mongoose.model<IPasswordReset>('PasswordReset', passwordResetSchema)
