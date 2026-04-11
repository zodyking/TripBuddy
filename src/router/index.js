import { createRouter, createWebHistory } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import MainDashboard from '../views/MainDashboard.vue'
import SettingsView from '../views/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
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
          path: 'settings',
          name: 'settings',
          component: SettingsView,
          meta: { title: 'Settings' },
        },
      ],
    },
  ],
})

router.afterEach((to) => {
  const title = to.matched.find((r) => r.meta?.title)?.meta?.title
  if (title) {
    document.title = `FedExTool — ${title}`
  }
})
