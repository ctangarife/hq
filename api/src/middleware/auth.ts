import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { authService, AuthTokenPayload } from '../services/auth.service.js'

/**
 * Auth Middleware — JWT ONLY (sin UI_SECRET para datos).
 *
 * El require() inline que usaba antes no funciona en ESM (type:module) —
   lanzaba ReferenceError que el catch interpretaba como token inválido,
   causando 401 en TODAS las requests con JWT válido (bug del deploy).
 */

const JWT_SECRET = process.env.API_JWT_SECRET || 'hq-dev-secret-change-in-prod'

export interface AuthRequest extends Request {
  user?: AuthTokenPayload
  workspaceId?: string
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Autenticación requerida',
      hint: 'Iniciá sesión en /login',
    })
  }

  const token = authHeader.substring(7)

  try {
    // Verificar JWT con el servicio (import ESM, no require)
    const payload = authService.verifyToken(token)
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
