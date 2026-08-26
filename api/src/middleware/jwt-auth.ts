import { Request, Response, NextFunction } from 'express'
import { authService, AuthTokenPayload } from '../services/auth.service.js'

/**
 * JWT Auth Middleware — Autenticación REAL por usuario.
 *
 * Acepta (en orden de prioridad):
 *   1. Authorization: Bearer <JWT> — usuario autenticado (req.user se setea)
 *   2. x-ui-secret: <UI_SECRET> — admin propio / transición (req.admin = true)
 *
 * El middleware NO rechaza si no hay JWT pero sí hay UI_SECRET — permite
 * coexistencia durante la migración. Cuando todo use JWT, se puede endurecer.
 */

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload
  isAdmin?: boolean
  workspaceId?: string
}

export function jwtAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // 1. Intentar JWT
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      const payload = authService.verifyToken(token)
      req.user = payload
      req.workspaceId = payload.workspaceId
      return next()
    } catch {
      // Token inválido — no rechazar aún, probar UI_SECRET
    }
  }

  // 2. UI_SECRET (compatibilidad / admin)
  const uiSecret = req.headers['x-ui-secret'] as string
  const validSecret = process.env.UI_SECRET || ''

  if (uiSecret && uiSecret === validSecret) {
    req.isAdmin = true
    return next()
  }

  // 3. Sin credenciales válidas
  return res.status(401).json({
    error: 'Unauthorized',
    hint: 'Usá Authorization: Bearer <token> (login) o x-ui-secret (admin)',
  })
}

/**
 * Middleware que EXIGE usuario autenticado (no acepta UI_SECRET).
 * Para rutas que son exclusivamente de usuario (perfil, etc.).
 */
export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Debés iniciar sesión' })
  }
  next()
}

/**
 * Middleware que EXIGE workspace (usuario con workspace asignado).
 */
export function requireWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.user.workspaceId) {
    return res.status(403).json({ error: 'No tenés un workspace asignado' })
  }
  next()
}

/**
 * Middleware que EXIGE rol mínimo (owner o manager).
 */
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Debés iniciar sesión' })
    }
    if (!roles.includes(req.user.role) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'No tenés permisos para esta acción' })
    }
    next()
  }
}
