import { Request, Response, NextFunction } from 'express'

const UI_SECRET = process.env.UI_SECRET || ''
const API_JWT_SECRET = process.env.API_JWT_SECRET || ''

// Extender Request para incluir user
export interface AuthRequest extends Request {
  user?: any
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check UI secret header (similar a openclaw-docker)
  const uiSecret = req.headers['x-ui-secret'] as string

  if (uiSecret && uiSecret === UI_SECRET) {
    return next()
  }

  // Check JWT token (para futura implementación)
  const authHeader = req.headers.authorization

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)

    // TODO: Verificar JWT con API_JWT_SECRET
    if (token) {
      return next()
    }
  }

  return res.status(401).json({ error: 'Unauthorized' })
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user) {
    return next()
  }
  return res.status(401).json({ error: 'Authentication required' })
}
