import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// Pages
import DashboardView from '@/views/DashboardView.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView
  },
  {
    path: '/missions',
    name: 'missions',
    component: () => import('@/views/MissionsView.vue')
  },
  {
    path: '/agents',
    name: 'agents',
    component: () => import('@/views/AgentsView.vue')
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/TasksView.vue')
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('@/views/ActivityView.vue')
  },
  {
    path: '/providers',
    name: 'providers',
    component: () => import('@/views/ProvidersView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
