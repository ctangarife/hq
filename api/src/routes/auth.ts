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
      // En dev: incluir el link para testing
      ...(process.env.NODE_ENV !== 'production' && {
        devRegistrationUrl: `${frontendUrl}/accept-invitation?token=${invitation.token}`,
      }),
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
