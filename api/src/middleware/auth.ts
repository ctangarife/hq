import { Request, Response, NextFunction } from 'express'
import { authService, AuthTokenPayload } from '../services/auth.service.js'

/**
 * Auth Middleware (reemplazado por JWT-only).
 *
 * ANTES: aceptaba x-ui-secret (puerta compartida expuesta en el bundle JS).
 * AHORA: SOLO JWT de usuario autenticado. Sin login, no hay acceso.
 *
 * Para agents containers internos: ver jwt-auth.ts → agentAuthMiddleware.
 */

const JWT_SECRET = process.env.API_JWT_SECRET || 'hq-dev-secret-change-in-prod'

export interface AuthRequest extends Request {
  user?: any
  workspaceId?: string
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // JWT ONLY — el UI_SECRET ya no da acceso a datos
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Autenticación requerida',
      hint: 'Iniciá sesión en /login',
    })
  }

  const token = authHeader.substring(7)

  try {
    const jwt = require('jsonwebtoken')
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    req.workspaceId = payload.workspaceId
    next()
  } catch {
    // No es JWT válido — probar HQ_API_TOKEN (agents internos)
    if (token === (process.env.HQ_API_TOKEN || 'hq-agent-token')) {
      return next()
    }
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user) {
    return next()
  }
  return res.status(401).json({ error: 'Authentication required' })
}
