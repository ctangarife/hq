import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Auth header para requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hq_token')
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Services
export const missionsService = {
  getAll: () => api.get('/missions'),
  getById: (id: string) => api.get(`/missions/${id}`),
  create: (data: any) => api.post('/missions', data),
  update: (id: string, data: any) => api.put(`/missions/${id}`, data),
  delete: (id: string) => api.delete(`/missions/${id}`),
  orchestrate: (id: string) => api.post(`/missions/${id}/orchestrate`),
  start: (id: string) => api.post(`/missions/${id}/start`),
  pause: (id: string, reason?: string) => api.post(`/missions/${id}/pause`, { reason }),
  resume: (id: string) => api.post(`/missions/${id}/resume`),
  cancel: (id: string, reason?: string) => api.post(`/missions/${id}/cancel`, { reason }),
  complete: (id: string) => api.post(`/missions/${id}/complete`),
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

export const providersService = {
  getAll: () => api.get('/providers'),
  getEnabled: () => api.get('/providers/enabled'),
  create: (data: any) => api.post('/providers', data),
  update: (providerId: string, data: any) => api.put(`/providers/${providerId}`, data),
  delete: (providerId: string) => api.delete(`/providers/${providerId}`),
  toggle: (providerId: string, enabled: boolean, apiKey?: string) =>
    api.post(`/providers/${providerId}/toggle`, apiKey ? { enabled, apiKey } : { enabled }),
  getModels: (providerId: string, refresh?: boolean) => api.get(`/providers/${providerId}/models${refresh ? '?refresh=true' : ''}`),
  refreshAll: () => api.post('/providers/refresh-all')
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

// Mission Templates Service (Phase 10.2)
export const templatesService = {
  // Get all templates
  getAll: (category?: string, tag?: string) => {
    const params = new URLSearchParams()
    if (category) params.append('category', category)
    if (tag) params.append('tag', tag)
    return api.get(`/mission-templates?${params.toString()}`)
  },
  // Get template by ID
  getById: (id: string) => api.get(`/mission-templates/${id}`),
  // Create custom template
  create: (data: any) => api.post('/mission-templates', data),
  // Update template
  update: (id: string, data: any) => api.put(`/mission-templates/${id}`, data),
  // Delete template
  delete: (id: string) => api.delete(`/mission-templates/${id}`),
  // Create mission from template
  createMission: (templateId: string, params: Record<string, string>) =>
    api.post(`/mission-templates/from-template/${templateId}`, { params }),
  // Initialize system templates
  initializeSystem: () => api.post('/mission-templates/initialize-system')
}

export default api
