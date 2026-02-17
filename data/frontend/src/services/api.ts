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

export default api
