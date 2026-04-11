<script setup>
// Root shell: routes render MainDashboard (/) or Settings (/settings).
</script>

<template>
  <RouterView />
</template>

<style>
:root {
  --bg: #0f0f12;
  --card: #1a1a21;
  --text: #e8e8ee;
  --muted: #9898a8;
  --accent: #5c2d91;
  --accent2: #d97706;
  --border: #2e2e38;
  --ok: #2e7d32;
  --app-content-max: 36rem;
  font-family: system-ui, Segoe UI, Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
}
</style>
