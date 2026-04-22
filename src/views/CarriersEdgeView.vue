<script setup>
/**
 * Carriers Edge sends `X-Frame-Options: SAMEORIGIN` — it cannot be embedded in our app’s iframe.
 * This view fills the content area and opens the real site in a new tab.
 */
const LOGIN_URL = 'https://www.carriersedge.com/ce/login.jsp?timeout=false'

function openCarriersEdge() {
  window.open(LOGIN_URL, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="ce-wrap">
    <h1 class="ce-title">Carriers Edge</h1>
    <p class="ce-lead">
      This site cannot be shown inside the app (browser security: <code>X-Frame-Options: SAMEORIGIN</code>).
      Use the button below to open the login page in a new tab. It will use the full window.
    </p>
    <button type="button" class="ce-btn tap" @click="openCarriersEdge">Open Carriers Edge</button>
    <p class="ce-url">
      <a :href="LOGIN_URL" class="ce-link" target="_blank" rel="noopener noreferrer">{{ LOGIN_URL }}</a>
    </p>
  </div>
</template>

<style scoped>
.ce-wrap {
  padding: var(--space-4, 1rem) var(--space-4, 1rem) var(--space-8, 2rem);
  max-width: var(--app-content-max, 40rem);
  margin-inline: auto;
  width: 100%;
  box-sizing: border-box;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  text-align: center;
  gap: 1rem;
}
.ce-title {
  margin: 0;
  font-size: 1.25rem;
  color: var(--color-text-primary, #f4f4f8);
}
.ce-lead {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-tertiary, #9a9aa8);
}
.ce-lead code {
  font-size: 0.8rem;
  color: #c4b5fd;
}
.ce-btn {
  align-self: center;
  min-height: 2.75rem;
  padding: 0.65rem 1.25rem;
  border-radius: 10px;
  border: none;
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
}
.ce-url {
  margin: 0;
  font-size: 0.78rem;
  word-break: break-all;
}
.ce-link {
  color: #93c5fd;
}
</style>
