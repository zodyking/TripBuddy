import { createRouter, createWebHistory } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import MainDashboard from '../views/MainDashboard.vue'
import SettingsView from '../views/SettingsView.vue'
import DirectoryView from '../views/DirectoryView.vue'
import HistoryView from '../views/HistoryView.vue'
import BridgesView from '../views/BridgesView.vue'
import LoginView from '../views/LoginView.vue'
import { getAuthStatus } from '../api.js'

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
          path: 'bridges',
          name: 'bridges',
          component: BridgesView,
          meta: { title: 'Bridges' },
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
