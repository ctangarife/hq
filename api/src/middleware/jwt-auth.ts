import { Request, Response, NextFunction } from 'express'
import { authService, AuthTokenPayload } from '../services/auth.service.js'

/**
 * JWT Auth Middleware — Autenticación REAL por usuario. JWT ONLY.
 *
 * El UI_SECRET ya NO da acceso a los datos de la API — estaba expuesto en
 * el bundle JavaScript del frontend (F12 → Sources) y anulaba el aislamiento
 * multi-tenant. Ahora TODA la API exige JWT de usuario autenticado.
 *
 * El UI_SECRET solo se usa internamente (agents containers → API polling),
 * NUNCA desde el navegador para ver datos.
 */

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload
  workspaceId?: string
}

export function jwtAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      const payload = authService.verifyToken(token)
      req.user = payload
      req.workspaceId = payload.workspaceId
      return next()
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado. Iniciá sesión de nuevo.' })
    }
  }

  // Sin JWT — rechazar
  return res.status(401).json({
    error: 'Autenticación requerida',
    hint: 'Iniciá sesión en /login para obtener un token',
  })
}

/**
 * Middleware que EXIGE usuario autenticado.
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
 * Middleware que EXIGE rol mínimo.
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

/**
 * Middleware para AGENTES (containers internos): acepta HQ_API_TOKEN.
 * Esto es lo que usa el polling skill del orchestrator para hablar con
 * la API — NO es para navegadores.
 */
export function agentAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    // 1. Es un JWT de usuario?
    try {
      const payload = authService.verifyToken(token)
      req.user = payload
      req.workspaceId = payload.workspaceId
      return next()
    } catch {
      // No es JWT válido — probar HQ_API_TOKEN
    }
    // 2. Es el HQ_API_TOKEN interno (para agents)?
    if (token === (process.env.HQ_API_TOKEN || 'hq-agent-token')) {
      return next()
    }
  }

  return res.status(401).json({ error: 'Autenticación requerida' })
}
