import { createRouter, createWebHistory } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import MainDashboard from '../views/MainDashboard.vue'
import SettingsView from '../views/SettingsView.vue'
import HistoryView from '../views/HistoryView.vue'
import TrafficView from '../views/TrafficView.vue'
import ChatView from '../views/ChatView.vue'
import TrailerGpsMapView from '../views/TrailerGpsMapView.vue'
import LoginView from '../views/LoginView.vue'
import { getAuthStatus } from '../api.js'

const DirectoryView = () => import('../views/DirectoryView.vue')

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { title: 'Login', public: true },
    },
    {
      path: '/',
      component: AppShell,
      children: [
        {
          path: '',
          name: 'home',
          component: MainDashboard,
          meta: { title: 'Dispatch' },
        },
        {
          path: 'chat',
          name: 'chat',
          component: ChatView,
          meta: { title: 'Chat' },
        },
        {
          path: 'directory',
          name: 'directory',
          component: DirectoryView,
          meta: { title: 'Directory' },
        },
        {
          path: 'history',
          name: 'history',
          component: HistoryView,
          meta: { title: 'History' },
        },
        {
          path: 'traffic',
          name: 'traffic',
          component: TrafficView,
          meta: { title: 'Traffic' },
        },
        {
          path: 'trailer-map',
          name: 'trailer-map',
          component: TrailerGpsMapView,
          meta: { title: 'Trailer map' },
        },
        {
          path: 'bridges',
          redirect: { name: 'traffic' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsView,
          meta: { title: 'Settings' },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta?.public) return true
  try {
    const s = await getAuthStatus()
    if (!s.authEnabled || s.authenticated) return true
  } catch {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return { name: 'login', query: { redirect: to.fullPath } }
})

router.afterEach((to) => {
  if (to.name === 'login') {
    document.title = 'Login'
    return
  }
  const title = to.matched.find((r) => r.meta?.title)?.meta?.title
  if (title) {
    document.title = `FedExTool — ${title}`
  }
})
