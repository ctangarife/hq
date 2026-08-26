import mongoose, { Schema, Document } from 'mongoose'
import type { UserRole } from './User.js'

export interface IInvitation extends Document {
  email: string
  workspaceId: mongoose.Types.ObjectId
  workspaceName: string
  role: UserRole
  token: string
  invitedBy: string
  invitedByName: string
  sentAt: Date
  expiresAt: Date
  acceptedAt?: Date
  acceptedByUserId?: mongoose.Types.ObjectId
  revokedAt?: Date
}

const invitationSchema = new Schema<IInvitation>({
  email: { type: String, required: true, lowercase: true, trim: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  workspaceName: { type: String, required: true },
  role: {
    type: String,
    enum: ['workspace_owner', 'workspace_manager', 'workspace_member', 'workspace_viewer'],
    default: 'workspace_member',
  },
  token: { type: String, required: true, unique: true, index: true },
  invitedBy: { type: String, required: true },
  invitedByName: { type: String, required: true },
  sentAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
  },
  acceptedAt: { type: Date },
  acceptedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  revokedAt: { type: Date },
}, {
  timestamps: true,
})

// Solo una invitación PENDIENTE por email+workspace
invitationSchema.index(
  { email: 1, workspaceId: 1, acceptedAt: 1 },
  { unique: true, partialFilterExpression: { acceptedAt: { $exists: false } } },
)

export default mongoose.model<IInvitation>('Invitation', invitationSchema)
