import { Router } from 'express'
import { authService } from '../services/auth.service.js'
import { AuthenticatedRequest, requireUser, jwtAuthMiddleware } from '../middleware/jwt-auth.js'
import Workspace from '../models/Workspace.js'

const router = Router()

/**
 * Auth Routes — Registro con invitación, login, perfil.
 *
 * Endpoints:
 *   POST  /api/auth/register           — Signup con token de invitación
 *   POST  /api/auth/login              — Login email+password → JWT
 *   GET   /api/auth/me                 — Perfil + workspace del usuario
 *   GET   /api/auth/invitation/:token  — Info de invitación (para la página de aceptación)
 *
 * Invitaciones (protegidas por JWT o UI_SECRET):
 *   POST  /api/auth/invitations        — Crear invitación (envía email)
 *   GET   /api/auth/invitations/:wsId  — Listar invitaciones de un workspace
 *   DELETE /api/auth/invitations/:id   — Revocar invitación
 */

// ═══════════════════════════════════════════════════════════
// PÚBLICAS (sin auth — son el punto de entrada)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PÚBLICAS (sin auth — son el punto de entrada)
// ═══════════════════════════════════════════════════════════

// POST /api/auth/forgot-password — Enviar email de recuperación
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ error: 'email es requerido' })
    }

    const User = (await import('../models/User.js')).default
    const PasswordReset = (await import('../models/PasswordReset.js')).default
    const crypto = (await import('crypto')).default

    const user = await User.findOne({ email: email.toLowerCase().trim(), active: true })
    if (!user) {
      // No revelar si el email existe (seguridad)
      return res.json({ message: 'Si el email existe, recibirás un link de recuperación' })
    }

    // Invalidar resets anteriores
    await PasswordReset.updateMany(
      { userId: user._id, usedAt: { $exists: false } },
      { usedAt: new Date() },
    )

    const token = crypto.randomBytes(32).toString('hex')
    await PasswordReset.create({
      userId: user._id,
      email: user.email,
      token,
    })

    // Enviar email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8093'
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`
    try {
      const { sendEmail } = await import('../services/email.service.js')
      await sendEmail({
        to: user.email,
        subject: '🔄 Recuperar contraseña — HQ',
        html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0f1424; border-radius: 16px; color: #e2e8f0;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; color: #ffffff;">🦞 HQ</h1>
          </div>
          <p style="font-size: 15px; color: #cbd5e1;">Hola ${user.name},</p>
          <p style="font-size: 15px; color: #cbd5e1;">Recibimos una solicitud para recuperar tu contraseña. Hacé clic en el botón de abajo:</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: #3b82f6; color: white; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 10px; text-decoration: none;">
              Crear nueva contraseña
            </a>
          </div>
          <p style="font-size: 13px; color: #64748b; text-align: center;">Este link expira en 1 hora.</p>
          <p style="font-size: 13px; color: #64748b; text-align: center;">Si no solicitaste esto, ignorá este email.</p>
        </div>`,
        text: `Recuperar contraseña: ${resetUrl}\n\nEste link expira en 1 hora.`,
      })
    } catch (emailErr: any) {
      console.warn(`⚠️ Reset email falló: ${emailErr.message}`)
    }

    res.json({ message: 'Si el email existe, recibirás un link de recuperación' })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/reset-password — Establecer nueva contraseña con token
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'token y newPassword son requeridos' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
    }

    const PasswordReset = (await import('../models/PasswordReset.js')).default
    const User = (await import('../models/User.js')).default
    const bcrypt = (await import('bcryptjs')).default

    const reset = await PasswordReset.findOne({
      token,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })

    if (!reset) {
      return res.status(400).json({ error: 'Link inválido o expirado' })
    }

    const user = await User.findById(reset.userId)
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10)
    await user.save()

    reset.usedAt = new Date()
    await reset.save()

    res.json({ message: 'Contraseña actualizada. Ya podés iniciar sesión.' })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/register — Signup con invitación
router.post('/register', async (req, res, next) => {
  try {
    const { invitationToken, email, password, name } = req.body

    if (!invitationToken || !email || !password || !name) {
      return res.status(400).json({
        error: 'invitationToken, email, password y name son requeridos',
      })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
    }

    const { user, token } = await authService.registerWithInvitation({
      invitationToken,
      email,
      password,
      name,
    })

    res.status(201).json({
      message: 'Cuenta creada exitosamente',
      user: user.toJSON(),
      token,
    })
  } catch (error: any) {
    if (error.message.includes('inválida') || error.message.includes('ya existe')) {
      return res.status(400).json({ error: error.message })
    }
    next(error)
  }
})

// POST /api/auth/login — Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' })
    }

    const { user, token } = await authService.login(email, password)

    res.json({
      message: 'Login exitoso',
      user: user.toJSON(),
      token,
    })
  } catch (error: any) {
    if (error.message.includes('incorrectos')) {
      return res.status(401).json({ error: error.message })
    }
    next(error)
  }
})

// GET /api/auth/invitation/:token — Info de invitación (página de aceptación)
router.get('/invitation/:token', async (req, res, next) => {
  try {
    const invitation = await authService.getInvitationByToken(req.params.token)

    if (!invitation) {
      return res.status(404).json({ error: 'Invitación no encontrada, expirada o ya utilizada' })
    }

    res.json({
      workspaceName: invitation.workspaceName,
      role: invitation.role,
      invitedByName: invitation.invitedByName,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    })
  } catch (error) {
    next(error)
  }
})

// ═══════════════════════════════════════════════════════════
// PROTEGIDAS (requieren JWT o UI_SECRET)
// ═══════════════════════════════════════════════════════════

// Aplicar JWT auth a las rutas protegidas
router.use(jwtAuthMiddleware)

// POST /api/auth/change-password — Cambiar contraseña del usuario autenticado
router.post('/change-password', requireUser, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword y newPassword son requeridos' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' })
    }

    const User = (await import('../models/User.js')).default
    const bcrypt = (await import('bcryptjs')).default

    const user = await User.findById(req.user!.userId)
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' })
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10)
    await user.save()

    res.json({ message: 'Contraseña actualizada exitosamente' })
  } catch (error) {
    next(error)
  }
})

// GET /api/auth/me — Perfil del usuario autenticado
router.get('/me', requireUser, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = req.user!

    let workspace = null
    if (user.workspaceId) {
      workspace = await Workspace.findById(user.workspaceId).select('name slug description').lean()
    }

    res.json({
      user: {
        id: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      workspace,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/invitations — Crear invitación (envía email)
router.post('/invitations', async (req, res, next) => {
  try {
    // Auth: JWT o UI_SECRET
    const authReq = req as AuthenticatedRequest
    const invitedBy = authReq.user?.userId || 'admin'
    const invitedByName = authReq.user?.name || 'Administrador HQ'

    const { email, workspaceId, role } = req.body

    if (!email || !workspaceId) {
      return res.status(400).json({ error: 'email y workspaceId son requeridos' })
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8093'

    const invitation = await authService.createInvitation({
      email,
      workspaceId,
      role: role || 'workspace_member',
      invitedBy,
      invitedByName,
      frontendUrl,
    })

    res.status(201).json({
      message: 'Invitación creada y enviada',
      invitationId: invitation._id,
      email: invitation.email,
      workspaceName: invitation.workspaceName,
    })
  } catch (error: any) {
    if (error.message.includes('ya') || error.message.includes('no encontrado')) {
      return res.status(409).json({ error: error.message })
    }
    next(error)
  }
})

// GET /api/auth/invitations/:workspaceId — Listar invitaciones de un workspace
router.get('/invitations/:workspaceId', async (req, res, next) => {
  try {
    const invitations = await authService.listInvitations(req.params.workspaceId)
    res.json(invitations)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/auth/invitations/:id — Revocar invitación
router.delete('/invitations/:id', async (req, res, next) => {
  try {
    await authService.revokeInvitation(req.params.id)
    res.json({ message: 'Invitación revocada' })
  } catch (error) {
    next(error)
  }
})

export default router
