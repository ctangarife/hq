import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User, { IUser, UserRole } from '../models/User.js'
import Invitation, { IInvitation } from '../models/Invitation.js'
import Workspace from '../models/Workspace.js'

/**
 * AuthService — Autenticación real con JWT + invitaciones por email.
 *
 * Flujo:
 *   1. Owner/admin crea invitación → email con link de registro
 *   2. Recipient hace clic → signup con ese email → asignado al workspace
 *   3. Login → JWT { userId, workspaceId, role, email }
 *   4. Middleware extrae JWT → req.user disponible en toda la API
 *
 * Reemplaza el patrón UI_SECRET compartido (puerta abierta sin identidad).
 * El UI_SECRET se mantiene para el admin propio durante la transición.
 */

const JWT_SECRET = process.env.API_JWT_SECRET || 'hq-dev-secret-change-in-prod'
const JWT_EXPIRES = '7d'
const SALT_ROUNDS = 10

export interface AuthTokenPayload {
  userId: string
  email: string
  name: string
  workspaceId?: string
  role: UserRole
}

class AuthService {
  /**
   * Registrar usuario con invitación. Valida que el email coincida con
   * la invitación y que no esté expirada/revocada/ya usada.
   */
  async registerWithInvitation(params: {
    invitationToken: string
    email: string
    password: string
    name: string
  }): Promise<{ user: IUser; token: string }> {
    const { invitationToken, email, password, name } = params

    // Buscar invitación válida
    const invitation = await Invitation.findOne({
      token: invitationToken,
      email: email.toLowerCase().trim(),
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })

    if (!invitation) {
      throw new Error('Invitación inválida, expirada o ya utilizada')
    }

    // Verificar que no exista ya un usuario con ese email
    const existing = await User.findOne({ email: email.toLowerCase().trim() })
    if (existing) {
      throw new Error('Ya existe una cuenta con este email. Iniciá sesión.')
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

    // Crear usuario
    const user = new User({
      email: email.toLowerCase().trim(),
      passwordHash,
      name,
      workspaceId: invitation.workspaceId,
      role: invitation.role,
      avatarSeed: name.toLowerCase().replace(/\s+/g, '-'),
    })
    await user.save()

    // Marcar invitación como aceptada
    invitation.acceptedAt = new Date()
    invitation.acceptedByUserId = user._id
    await invitation.save()

    // Añadir al workspace como member (mapear role de User a Workspace)
    const workspace = await Workspace.findById(invitation.workspaceId)
    if (workspace) {
      // User roles: workspace_owner/manager/member/viewer
      // Workspace roles: owner/manager/member/viewer
      const wsRole = invitation.role.replace('workspace_', '') as any
      workspace.members.push({
        userId: user._id.toString(),
        email: user.email,
        role: wsRole,
        addedAt: new Date(),
      })
      await workspace.save()
    }

    const token = this.generateToken(user)
    return { user, token }
  }

  /**
   * Login con email + password. Devuelve JWT.
   */
  async login(email: string, password: string): Promise<{ user: IUser; token: string }> {
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      active: true,
    })

    if (!user) {
      throw new Error('Email o contraseña incorrectos')
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      throw new Error('Email o contraseña incorrectos')
    }

    user.lastLoginAt = new Date()
    await user.save()

    const token = this.generateToken(user)
    return { user, token }
  }

  /**
   * Verificar JWT y devolver el payload.
   */
  verifyToken(token: string): AuthTokenPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as AuthTokenPayload
    } catch {
      throw new Error('Token inválido o expirado')
    }
  }

  /**
   * Crear invitación para un email → workspace con rol específico.
   * Genera token único y envía el email.
   */
  async createInvitation(params: {
    email: string
    workspaceId: string
    role: UserRole
    invitedBy: string
    invitedByName: string
    frontendUrl: string
  }): Promise<IInvitation> {
    const { email, workspaceId, role, invitedBy, invitedByName, frontendUrl } = params

    const workspace = await Workspace.findById(workspaceId)
    if (!workspace) {
      throw new Error('Workspace no encontrado')
    }

    // Verificar que no haya invitación pendiente para este email+workspace
    const existing = await Invitation.findOne({
      email: email.toLowerCase().trim(),
      workspaceId,
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
    })
    if (existing) {
      throw new Error('Ya existe una invitación pendiente para este email en este workspace')
    }

    // Verificar que no sea ya miembro
    const alreadyMember = workspace.members.some(m => m.email === email.toLowerCase().trim())
    if (alreadyMember) {
      throw new Error('Este email ya es miembro del workspace')
    }

    const token = crypto.randomBytes(32).toString('hex')

    const invitation = new Invitation({
      email: email.toLowerCase().trim(),
      workspaceId,
      workspaceName: workspace.name,
      role,
      token,
      invitedBy,
      invitedByName,
    })
    await invitation.save()

    // Enviar email (no bloquear si falla — la invitación queda creada)
    try {
      const { sendInvitationEmail } = await import('./email.service.js')
      await sendInvitationEmail({
        to: email,
        workspaceName: workspace.name,
        invitedByName,
        role,
        registrationUrl: `${frontendUrl}/accept-invitation?token=${token}`,
      })
      console.log(`📧 Invitación enviada a ${email}`)
    } catch (emailErr: any) {
      console.warn(`⚠️ Email falló (${emailErr.message}) — invitación creada, enviar manual:`)
      console.warn(`   ${frontendUrl}/accept-invitation?token=${token}`)
    }

    return invitation
  }

  /**
   * Obtener invitación por token (para la página de aceptación).
   */
  async getInvitationByToken(token: string): Promise<IInvitation | null> {
    return await Invitation.findOne({
      token,
      acceptedAt: { $exists: false },
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
  }

  /**
   * Revocar invitación.
   */
  async revokeInvitation(invitationId: string): Promise<void> {
    await Invitation.findByIdAndUpdate(invitationId, { revokedAt: new Date() })
  }

  /**
   * Listar invitaciones de un workspace.
   */
  async listInvitations(workspaceId: string): Promise<IInvitation[]> {
    return await Invitation.find({ workspaceId })
      .sort({ createdAt: -1 })
      .select('-token') // no exponer el token en listados
      .lean()
  }

  private generateToken(user: IUser): string {
    const payload: AuthTokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      workspaceId: user.workspaceId?.toString(),
      role: user.role,
    }
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES })
  }
}

export const authService = new AuthService()
export default authService
