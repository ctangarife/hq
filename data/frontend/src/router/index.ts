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
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue')
  },
  {
    path: '/accept-invitation',
    name: 'accept-invitation',
    component: () => import('@/views/LoginView.vue')
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/LoginView.vue')
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
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue')
  },
  {
    path: '/guide',
    name: 'guide',
    component: () => import('@/views/GuideView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

// Route guard: exigir JWT para todas las rutas excepto login/invitation
router.beforeEach((to, _from, next) => {
  const publicRoutes = ['/login', '/accept-invitation', '/reset-password']
  const isPublic = publicRoutes.some(r => to.path.startsWith(r))
  const token = localStorage.getItem('hq_token')

  if (!token && !isPublic) {
    next('/login')
  } else if (token && isPublic && !to.path.includes('accept-invitation')) {
    // Ya logueado, no mostrar login de nuevo (excepto si es invitación)
    next('/')
  } else {
    next()
  }
})

export default router
