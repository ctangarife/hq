import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// JWT de usuario autenticado — ÚNICA forma de auth del frontend.
// El UI_SECRET ya NO se envía desde el cliente (estaba expuesto en el
// bundle JavaScript — cualquiera con F12 lo veía). Para acceder, login.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hq_token')
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Si la API responde 401, limpiar token y redirigir a login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('hq_token')
      localStorage.removeItem('hq_user')
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Services
export const missionsService = {
  getAll: () => api.get('/missions'),
  getById: (id: string) => api.get(`/missions/${id}`),
  create: (data: any) => api.post('/missions', data),
  // Enriquecedor: idea breve → brief profesional (glm-5.2), no crea nada
  enrich: (seed: string, mode?: 'content' | 'fact_check') =>
    api.post('/missions/enrich', { seed, mode }, { timeout: 120000 }),
  dashboardStats: () => api.get('/missions/dashboard-stats'),
  update: (id: string, data: any) => api.put(`/missions/${id}`, data),
  delete: (id: string) => api.delete(`/missions/${id}`),
  orchestrate: (id: string) => api.post(`/missions/${id}/orchestrate`),
  start: (id: string) => api.post(`/missions/${id}/start`),
  pause: (id: string, reason?: string) => api.post(`/missions/${id}/pause`, { reason }),
  resume: (id: string) => api.post(`/missions/${id}/resume`),
  cancel: (id: string, reason?: string) => api.post(`/missions/${id}/cancel`, { reason }),
  complete: (id: string) => api.post(`/missions/${id}/complete`),
  restart: (id: string) => api.post(`/missions/${id}/restart`),
  getProgress: (id: string) => api.get(`/missions/${id}/progress`),
  getTimeline: (id: string) => api.get(`/missions/${id}/timeline`)
}

export const agentsService = {
  getAll: () => api.get('/agents'),
  getById: (id: string) => api.get(`/agents/${id}`),
  create: (data: any) => api.post('/agents', data),
  update: (id: string, data: any) => api.put(`/agents/${id}`, data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  deploy: (id: string) => api.post(`/agents/${id}/deploy`),
  start: (id: string) => api.post(`/agents/${id}/start`),
  stop: (id: string) => api.post(`/agents/${id}/stop`),
  getStatus: (id: string) => api.get(`/agents/${id}/status`),
  getLogs: (id: string, tail?: number) => api.get(`/agents/${id}/logs`, { params: { tail } }),
  streamLogs: (id: string) => new EventSource(`${API_URL}/agents/${id}/logs/stream`),
  destroyContainer: (id: string) => api.delete(`/agents/${id}/container`),
  getMetrics: (id: string) => api.get(`/agents/${id}/metrics`),
  getAllMetrics: () => api.get('/agents/metrics'),
  getSystemMetrics: (startDate?: string, endDate?: string) =>
    api.get('/agents/metrics/system', { params: { startDate, endDate } })
}

export const tasksService = {
  getAll: () => api.get('/tasks'),
  getById: (id: string) => api.get(`/tasks/${id}`),
  getByMission: (missionId: string) => api.get(`/tasks?missionId=${missionId}`),
  getHumanTasks: (missionId?: string) => api.get(`/tasks/human/list${missionId ? `?missionId=${missionId}` : ''}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  updateStatus: (id: string, status: string, output?: any) => api.post(`/tasks/${id}/status`, { status, output }),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  processSquadOutput: (id: string, output: any) => api.post(`/tasks/${id}/process-squad-output`, { output }),
  submitHumanResponse: (id: string, response: string) => api.post(`/tasks/${id}/human-response`, { response }),
  streamTasks: () => new EventSource(`${API_URL}/tasks/stream`)
}

export const modelsService = {
  getProviders: () => api.get('/models/providers'),
  getProviderModels: (providerId: string) => api.get(`/models/providers/${providerId}/models`),
  getModelInfo: (providerId: string, modelId: string) => api.get(`/models/${providerId}/${modelId}`)
}

export const activityService = {
  getAll: () => api.get('/activity'),  // Note: api base URL already includes /api prefix
  subscribe: () => new EventSource(`${API_URL}/activity/stream`)
}

export const attachmentsService = {
  // Upload file and create attachment
  upload: (missionId: string, file: File, type?: string, taskId?: string, description?: string, role?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('missionId', missionId)
    if (taskId) formData.append('taskId', taskId)
    if (type) formData.append('type', type)
    if (description) formData.append('description', description)
    if (role) formData.append('role', role)

    return api.post('/attachments/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  // List attachments for mission
  getByMission: (missionId: string, type?: string) =>
    api.get(`/attachments/mission/${missionId}${type ? `?type=${type}` : ''}`),
  // List attachments for task
  getByTask: (taskId: string) => api.get(`/attachments/task/${taskId}`),
  // Download attachment
  download: (attachmentId: string) => {
    const token = localStorage.getItem('hq_token')
    window.open(`${API_URL}/attachments/${attachmentId}/download?token=${token}`, '_blank')
  },
  // Delete attachment
  delete: (attachmentId: string) => api.delete(`/attachments/${attachmentId}`),
  // Update attachment metadata
  update: (attachmentId: string, data: { description?: string; role?: string; order?: number }) =>
    api.patch(`/attachments/${attachmentId}`, data),
  // Reorder attachments
  reorder: (attachmentIds: string[]) => api.post('/attachments/reorder', { attachmentIds })
}

export const resourcesService = {
  // Upload file to mission inputs
  uploadToMission: (missionId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return api.post(`/resources/mission/${missionId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  // Save URL as resource
  saveURL: (missionId: string, url: string, title?: string) =>
    api.post(`/resources/mission/${missionId}/upload-url`, { url, title }),
  // List mission files
  getMissionFiles: (missionId: string) => api.get(`/resources/mission/${missionId}/files`),
  // Download mission input file
  downloadMissionFile: (missionId: string, filename: string) => {
    const token = localStorage.getItem('hq_token')
    window.open(`${API_URL}/resources/mission/${missionId}/download/${filename}?token=${token}`, '_blank')
  },
  // Download final output
  downloadOutput: (missionId: string, format: 'md' | 'pdf' = 'md') => {
    const token = localStorage.getItem('hq_token')
    window.open(`${API_URL}/resources/mission/${missionId}/outputs/download?format=${format}&token=${token}`, '_blank')
  },
  // Consolidate mission outputs
  consolidate: (missionId: string) => api.post(`/resources/mission/${missionId}/consolidate`),
  // Get mission size
  getSize: (missionId: string) => api.get(`/resources/mission/${missionId}/size`),
  // Get task output
  getTaskOutput: (taskId: string, missionId: string) => api.get(`/resources/task/${taskId}/output?missionId=${missionId}`),
  // Stream task output (SSE)
  streamTaskOutput: (taskId: string, missionId: string) =>
    new EventSource(`${API_URL}/resources/task/${taskId}/stream?missionId=${missionId}`)
}

// =====================================================================
// Admin Services (multi-tenant: workspaces, prompts, llm keys)
// =====================================================================

// Workspaces + Projects (jerarquía multi-tenant)
export const workspacesService = {
  getAll: () => api.get('/workspaces'),
  getById: (id: string) => api.get(`/workspaces/${id}`),
  create: (data: any) => api.post('/workspaces', data),
  update: (id: string, data: any) => api.patch(`/workspaces/${id}`, data),
  delete: (id: string) => api.delete(`/workspaces/${id}`),
  // Proyectos dentro de un workspace
  getProjects: (id: string) => api.get(`/workspaces/${id}/projects`),
  createProject: (workspaceId: string, data: any) => api.post(`/workspaces/${workspaceId}/projects`, data),
}

// Prompts editables (resolución por capas: project → workspace → global)
export const promptsService = {
  // Listar con filtros opcionales (?key, ?scope, ?workspaceId, ?projectId)
  getAll: (filters?: Record<string, string>) => api.get('/prompts', { params: filters }),
  // Resolver un prompt por capas con variables reemplazadas (preview en vivo)
  resolve: (key: string, variables?: Record<string, string>) =>
    api.get(`/prompts/resolve/${key}`, { params: variables }),
  // Crear o actualizar (upsert)
  upsert: (data: any) => api.post('/prompts', data),
  // Desactivar (soft delete)
  delete: (id: string) => api.delete(`/prompts/${id}`),
}

// LLM Config (virtual keys de LiteLLM, enmascaradas en la respuesta)
export const llmConfigService = {
  getAll: () => api.get('/llm-config'),
}

// =====================================================================
// Auth Services
// =====================================================================
export const authService = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  logout: () => {
    localStorage.removeItem('hq_token')
    localStorage.removeItem('hq_user')
    window.location.href = '/login'
  },
  // Invitaciones
  createInvitation: (email: string, workspaceId: string, role: string) =>
    api.post('/auth/invitations', { email, workspaceId, role }),
  listInvitations: (workspaceId: string) =>
    api.get(`/auth/invitations/${workspaceId}`),
  revokeInvitation: (invitationId: string) =>
    api.delete(`/auth/invitations/${invitationId}`),
}

export default api
