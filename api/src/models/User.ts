import mongoose, { Schema, Document } from 'mongoose'

export type UserRole = 'super_admin' | 'workspace_owner' | 'workspace_manager' | 'workspace_member' | 'workspace_viewer'

export interface IUser extends Document {
  email: string
  passwordHash: string
  name: string
  workspaceId?: mongoose.Types.ObjectId
  role: UserRole
  avatarSeed?: string
  active: boolean
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'email inválido'],
  },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
  role: {
    type: String,
    enum: ['super_admin', 'workspace_owner', 'workspace_manager', 'workspace_member', 'workspace_viewer'],
    default: 'workspace_member',
  },
  avatarSeed: { type: String },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
}, {
  timestamps: true,
})

// Nunca devolver passwordHash en queries
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash
    delete ret.__v
    return ret
  },
})

export default mongoose.model<IUser>('User', userSchema)
