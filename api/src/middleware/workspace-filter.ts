import { AuthenticatedRequest } from './jwt-auth.js'

/**
 * Workspace Filter — Aislamiento multi-tenant real.
 *
 * Una sola función que determina qué puede ver el usuario:
 *   - super_admin: TODO (soporte, gestión global)
 *   - cualquier otro rol: SOLO su workspace
 *
 * Se usa en los endpoints de datos (missions, agents, tasks, etc.)
 * para filtrar las queries de Mongo por workspaceId.
 */

export interface WorkspaceScope {
  /** Query filter para Mongo (ej: { workspaceId: "..." } o {} para admin) */
  filter: Record<string, any>
  /** True si el usuario puede ver todo (super_admin) */
  isGlobal: boolean
  /** El workspaceId del usuario (null para super_admin) */
  workspaceId: string | null
}

export function getWorkspaceScope(req: AuthenticatedRequest): WorkspaceScope {
  // Sin usuario (auth via HQ_API_TOKEN para agents) → ver todo por ahora
  // (los agents necesitan acceso a tareas de cualquier workspace)
  if (!req.user) {
    return { filter: {}, isGlobal: true, workspaceId: null }
  }

  // super_admin ve todo
  if (req.user.role === 'super_admin') {
    return { filter: {}, isGlobal: true, workspaceId: null }
  }

  // Usuario sin workspace → no ve nada (evita leaking)
  if (!req.user.workspaceId) {
    return { filter: { _id: { $exists: false } }, isGlobal: false, workspaceId: null }
  }

  // Usuario con workspace → solo lo suyo
  return {
    filter: { workspaceId: req.user.workspaceId },
    isGlobal: false,
    workspaceId: req.user.workspaceId,
  }
}

/**
 * Para misiones que NO tienen workspaceId (misiones globales/legacy):
 * incluir las que no tienen workspace asignado. Solo si el usuario tiene
 * workspace — un usuario de "La Estantería" no debe ver misiones globales
 * de otro contexto.
 */
export function getMissionFilter(req: AuthenticatedRequest): Record<string, any> {
  const scope = getWorkspaceScope(req)

  if (scope.isGlobal) return {}

  // Solo misiones de MI workspace (las globales/legacy no son visibles)
  return { workspaceId: scope.workspaceId }
}
