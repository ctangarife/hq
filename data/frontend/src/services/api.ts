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
  orchestrate: (id: string) => api.post(`/missions/${id}/orchestrate`)
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
  getLogs: (id: string, tail?: number) => api.get(`/agents/${id}/logs${tail ? `?tail=${tail}` : ''}`),
  destroyContainer: (id: string) => api.delete(`/agents/${id}/container`)
}

export const tasksService = {
  getAll: () => api.get('/tasks'),
  getById: (id: string) => api.get(`/tasks/${id}`),
  getByMission: (missionId: string) => api.get(`/tasks?missionId=${missionId}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  processSquadOutput: (id: string, output: any) => api.post(`/tasks/${id}/process-squad-output`, { output })
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
  getAll: () => api.get('/activity'),
  subscribe: () => new EventSource(`${API_URL}/activity/stream`)
}

export default api
