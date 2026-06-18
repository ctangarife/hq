import Workspace, { WorkspaceMember, WorkspaceRole } from '../models/Workspace.js'
import Project from '../models/Project.js'

/**
 * WorkspaceService - Gestión de workspaces (clientes/agencias)
 *
 * CRUD de workspaces + gestión de miembros. Cada workspace es el contenedor
 * de nivel superior en la jerarquía multi-tenant: Workspace → Project → Mission.
 */

class WorkspaceService {
  async listWorkspaces() {
    return await Workspace.find({ active: true })
      .populate('llmConfigId', 'alias virtualKey')
      .sort({ name: 1 })
      .lean()
  }

  async getWorkspace(id: string) {
    return await Workspace.findById(id)
      .populate('llmConfigId', 'alias virtualKey')
      .lean()
  }

  async createWorkspace(params: {
    name: string
    slug: string
    description?: string
    ownerId: string
    avatarStyle?: string
  }) {
    // El owner se añade como miembro automáticamente con rol 'owner'
    const ownerMember: WorkspaceMember = {
      userId: params.ownerId,
      role: 'owner' as WorkspaceRole,
      addedAt: new Date(),
    }

    return await Workspace.create({
      name: params.name,
      slug: params.slug,
      description: params.description,
      ownerId: params.ownerId,
      members: [ownerMember],
      avatarStyle: params.avatarStyle || 'avataaars',
      active: true,
    })
  }

  async updateWorkspace(id: string, updates: Partial<{
    name: string
    description: string
    avatarStyle: string
    llmConfigId: string
  }>) {
    return await Workspace.findByIdAndUpdate(id, updates, { new: true }).lean()
  }

  async deleteWorkspace(id: string) {
    // Soft delete: desactivar workspace + sus proyectos
    await Workspace.findByIdAndUpdate(id, { active: false })
    await Project.updateMany({ workspaceId: id }, { active: false, status: 'archived' })
    return { deleted: true }
  }

  // =====================================================================
  // Miembros
  // =====================================================================

  async addMember(workspaceId: string, member: { userId: string; email?: string; role: WorkspaceRole }) {
    return await Workspace.findByIdAndUpdate(
      workspaceId,
      { $push: { members: { ...member, addedAt: new Date() } } },
      { new: true },
    ).lean()
  }

  async removeMember(workspaceId: string, userId: string) {
    return await Workspace.findByIdAndUpdate(
      workspaceId,
      { $pull: { members: { userId } } },
      { new: true },
    ).lean()
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
    return await Workspace.findOneAndUpdate(
      { _id: workspaceId, 'members.userId': userId },
      { $set: { 'members.$.role': role } },
      { new: true },
    ).lean()
  }

  // =====================================================================
  // Proyectos del workspace
  // =====================================================================

  async listProjects(workspaceId: string) {
    return await Project.find({ workspaceId, active: true })
      .sort({ name: 1 })
      .lean()
  }

  async createProject(workspaceId: string, params: {
    name: string
    slug: string
    description?: string
    llmConfigId?: string
    avatarStyle?: string
  }) {
    // Verificar que el workspace existe y está activo
    const ws = await Workspace.findById(workspaceId).lean()
    if (!ws || !ws.active) {
      throw new Error(`Workspace ${workspaceId} not found or inactive`)
    }

    return await Project.create({
      ...params,
      workspaceId,
      status: 'active',
      active: true,
    })
  }
}

export const workspaceService = new WorkspaceService()
export default workspaceService
