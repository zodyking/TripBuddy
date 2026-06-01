<script setup>
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { postVisitPing, getAuthStatus, getPublicGeoFenceCheck } from './api.js'
import { hydrateAllTrafficKeysFromServer } from './stores/trafficTileKey.js'
import { hydrateBridgeTrafficProfilesFromServer } from './stores/bridgeTrafficProfilesStore.js'
import { hydrateSenderTextEnFromServer } from './utils/senderNameTranslateClient.js'
import { hydrateWahaPrefsFromServer } from './utils/wahaPrefs.js'
import { hydrateBlueBubblesPrefsFromServer } from './utils/blueBubblesPrefs.js'

/** One IP capture per tab session when the SPA loads (security audit). */
const VISIT_PING_KEY = 'fedextool-visit-ping-v1'
/** Dev / SPA: server geo-fence runs on static HTML; this catches Vite dev and edge cases. */
const GEO_FENCE_SPA_KEY = 'fedextool-geo-fence-spa-v1'

const route = useRoute()

onMounted(() => {
  try {
    if (sessionStorage.getItem(VISIT_PING_KEY) === '1') return
    sessionStorage.setItem(VISIT_PING_KEY, '1')
  } catch {
    /* private mode — still try ping */
  }
  void postVisitPing().catch(() => {})
  void hydrateAllTrafficKeysFromServer()
  void hydrateBridgeTrafficProfilesFromServer()
  void hydrateSenderTextEnFromServer()
  void hydrateWahaPrefsFromServer()
  void hydrateBlueBubblesPrefsFromServer()

  void (async () => {
    try {
      if (sessionStorage.getItem(GEO_FENCE_SPA_KEY) === '1') return
      const st = await getAuthStatus()
      if (!st.authEnabled || st.authenticated) return
      if (route.path.endsWith('/login')) return
      const g = await getPublicGeoFenceCheck()
      if (g.redirectTo && typeof g.redirectTo === 'string') {
        sessionStorage.setItem(GEO_FENCE_SPA_KEY, '1')
        window.location.assign(g.redirectTo)
      }
    } catch {
      /* ignore */
    }
  })()
})
</script>

<template>
  <RouterView />
</template>

<style>
:root {
  /* ══════════════════════════════════════════════════════════════════════════
     DESIGN TOKENS — Premium SaaS Design System
     ══════════════════════════════════════════════════════════════════════════ */

  /* ─── Color Palette ─────────────────────────────────────────────────────── */
  /* Base surfaces */
  --color-bg-base: #08080a;
  --color-bg-elevated: #0f0f14;
  --color-bg-surface: #16161d;
  --color-bg-overlay: rgba(8, 8, 10, 0.85);

  /* Glass effects */
  --color-glass: rgba(22, 22, 29, 0.72);
  --color-glass-border: rgba(255, 255, 255, 0.06);
  --color-glass-highlight: rgba(255, 255, 255, 0.03);

  /* Text hierarchy */
  --color-text-primary: #f4f4f8;
  --color-text-secondary: #a8a8b8;
  --color-text-tertiary: #6e6e7e;
  --color-text-inverse: #08080a;

  /* Brand — FedEx Purple & Orange */
  --color-accent-purple: #7b4db5;
  --color-accent-purple-light: #9d6fd7;
  --color-accent-purple-dark: #5c2d91;
  --color-accent-orange: #ff6b1a;
  --color-accent-orange-light: #ff8a4d;
  --color-accent-orange-dark: #d97706;

  /* Semantic colors */
  --color-success: #22c55e;
  --color-success-muted: rgba(34, 197, 94, 0.15);
  --color-success-border: rgba(34, 197, 94, 0.3);
  --color-warning: #f59e0b;
  --color-warning-muted: rgba(245, 158, 11, 0.15);
  --color-warning-border: rgba(245, 158, 11, 0.3);
  --color-error: #ef4444;
  --color-error-muted: rgba(239, 68, 68, 0.15);
  --color-error-border: rgba(239, 68, 68, 0.3);
  --color-info: #3b82f6;
  --color-info-muted: rgba(59, 130, 246, 0.15);
  --color-info-border: rgba(59, 130, 246, 0.3);

  /* Interactive states */
  --color-border: rgba(255, 255, 255, 0.08);
  --color-border-subtle: rgba(255, 255, 255, 0.04);
  --color-border-focus: var(--color-accent-purple);
  --color-hover: rgba(255, 255, 255, 0.04);
  --color-active: rgba(255, 255, 255, 0.08);

  /* Accent background (solid purple — no gradient rainbow) */
  --gradient-accent: var(--color-accent-purple);
  --gradient-surface: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
  --gradient-glow-purple: radial-gradient(ellipse at center, rgba(123, 77, 181, 0.15) 0%, transparent 70%);
  --gradient-glow-orange: radial-gradient(ellipse at center, rgba(255, 107, 26, 0.1) 0%, transparent 70%);

  /* ─── Typography ────────────────────────────────────────────────────────── */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', 'Consolas', monospace;

  /* Type scale */
  --text-xs: 0.6875rem;    /* 11px */
  --text-sm: 0.8125rem;    /* 13px */
  --text-base: 0.9375rem;  /* 15px */
  --text-md: 1rem;         /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.3125rem;    /* 21px */
  --text-2xl: 1.625rem;    /* 26px */
  --text-3xl: 2rem;        /* 32px */

  /* Line heights */
  --leading-none: 1;
  --leading-tight: 1.2;
  --leading-snug: 1.35;
  --leading-normal: 1.5;
  --leading-relaxed: 1.65;

  /* Font weights */
  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  /* Letter spacing */
  --tracking-tight: -0.02em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
  --tracking-wider: 0.05em;

  /* ─── Spacing (4px base unit) ───────────────────────────────────────────── */
  --space-0: 0;
  --space-px: 1px;
  --space-0-5: 0.125rem;   /* 2px */
  --space-1: 0.25rem;      /* 4px */
  --space-1-5: 0.375rem;   /* 6px */
  --space-2: 0.5rem;       /* 8px */
  --space-2-5: 0.625rem;   /* 10px */
  --space-3: 0.75rem;      /* 12px */
  --space-3-5: 0.875rem;   /* 14px */
  --space-4: 1rem;         /* 16px */
  --space-5: 1.25rem;      /* 20px */
  --space-6: 1.5rem;       /* 24px */
  --space-7: 1.75rem;      /* 28px */
  --space-8: 2rem;         /* 32px */
  --space-9: 2.25rem;      /* 36px */
  --space-10: 2.5rem;      /* 40px */
  --space-12: 3rem;        /* 48px */
  --space-14: 3.5rem;      /* 56px */
  --space-16: 4rem;        /* 64px */

  /* ─── Border Radius ─────────────────────────────────────────────────────── */
  --radius-none: 0;
  --radius-sm: 0.375rem;   /* 6px */
  --radius-md: 0.5rem;     /* 8px */
  --radius-lg: 0.75rem;    /* 12px */
  --radius-xl: 1rem;       /* 16px */
  --radius-2xl: 1.25rem;   /* 20px */
  --radius-3xl: 1.5rem;    /* 24px */
  --radius-full: 9999px;

  /* ─── Shadows ───────────────────────────────────────────────────────────── */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.25);
  --shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.4), 0 8px 16px rgba(0, 0, 0, 0.3);
  --shadow-glow-purple: 0 0 20px rgba(123, 77, 181, 0.25), 0 0 40px rgba(123, 77, 181, 0.1);
  --shadow-glow-orange: 0 0 20px rgba(255, 107, 26, 0.2), 0 0 40px rgba(255, 107, 26, 0.08);
  --shadow-inset: inset 0 1px 2px rgba(0, 0, 0, 0.3);

  /* ─── Glass Effects ─────────────────────────────────────────────────────── */
  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 20px;
  --blur-xl: 32px;

  /* ─── Transitions ───────────────────────────────────────────────────────── */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;

  --transition-colors: color var(--duration-normal) var(--ease-out),
                       background-color var(--duration-normal) var(--ease-out),
                       border-color var(--duration-normal) var(--ease-out);
  --transition-transform: transform var(--duration-normal) var(--ease-out);
  --transition-opacity: opacity var(--duration-normal) var(--ease-out);
  --transition-all: all var(--duration-normal) var(--ease-out);

  /* ─── Z-Index Scale ─────────────────────────────────────────────────────── */
  --z-base: 0;
  --z-dropdown: 10;
  --z-sticky: 20;
  --z-header: 30;
  --z-overlay: 40;
  --z-modal: 50;
  --z-toast: 60;
  --z-tooltip: 70;

  /* ─── Layout ────────────────────────────────────────────────────────────── */
  --app-content-max: 40rem;
  --header-height: 3.75rem;
  --nav-height: 4rem;
  --touch-target: 2.75rem; /* 44px */

  /* Floating controls on Leaflet maps (satellite, locate, traffic, …) */
  --map-controls-offset-x: var(--space-3, 0.75rem);
  --map-controls-offset-y: var(--space-3, 0.75rem);
  --map-controls-gap: var(--space-2, 0.5rem);
  --map-controls-z: 900;
  /* Vertical space below Leaflet zoom (+/−) so custom buttons do not overlap */
  --map-zoom-stack-clearance: 5.35rem;

  /* ─── Legacy Compatibility (mapped to new tokens) ───────────────────────── */
  --bg: var(--color-bg-base);
  --card: var(--color-bg-surface);
  --text: var(--color-text-primary);
  --muted: var(--color-text-secondary);
  --accent: var(--color-accent-purple);
  --accent2: var(--color-accent-orange);
  --border: var(--color-border);
  --ok: var(--color-success);

  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
  background: var(--color-bg-base);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
  scroll-behavior: smooth;
}

body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  background: var(--color-bg-base);
}

/*
 * Pin the Vue root to the layout viewport so mobile Safari cannot vertically
 * rubber-band the whole page (which makes the bottom nav appear to “scroll”).
 * Routed views fill this box via flex; inner panes keep their own overflow.
 */
#app {
  position: fixed;
  inset: 0;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
  display: flex;
  flex-direction: column;
}

#app > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITY CLASSES
   ═══════════════════════════════════════════════════════════════════════════ */

/* Glass card base */
.glass {
  background: var(--color-glass);
  backdrop-filter: blur(var(--blur-lg));
  -webkit-backdrop-filter: blur(var(--blur-lg));
  border: 1px solid var(--color-glass-border);
  box-shadow: var(--shadow-md), inset 0 1px 0 var(--color-glass-highlight);
}

.glass-subtle {
  background: rgba(22, 22, 29, 0.5);
  backdrop-filter: blur(var(--blur-md));
  -webkit-backdrop-filter: blur(var(--blur-md));
  border: 1px solid var(--color-border-subtle);
}

/* Gradient border effect */
.gradient-border {
  position: relative;
}
.gradient-border::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--gradient-accent);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0.5;
  pointer-events: none;
}

/* Interactive tap feedback */
.tap {
  cursor: pointer;
  transition: var(--transition-all);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.tap:hover {
  background-color: var(--color-hover);
}
.tap:active {
  transform: scale(0.98);
  opacity: 0.9;
}
.tap:focus-visible {
  outline: 2px solid var(--color-accent-purple);
  outline-offset: 2px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAP OVERLAY CONTROLS (Leaflet) — shared placement + chrome
   ═══════════════════════════════════════════════════════════════════════════ */

.map-controls-stack {
  position: absolute;
  z-index: var(--map-controls-z, 900);
  top: calc(var(--map-controls-offset-y) + var(--map-zoom-stack-clearance, 5.35rem));
  right: var(--map-controls-offset-x);
  bottom: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--map-controls-gap);
  pointer-events: none;
}

/* Leaflet built-ins — match custom controls (top-right) app-wide */
.leaflet-container .leaflet-top.leaflet-right {
  top: var(--map-controls-offset-y);
  right: var(--map-controls-offset-x);
}

.leaflet-container .leaflet-control-zoom {
  margin-top: 0 !important;
  margin-right: 0 !important;
  border: none;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.35));
}

.map-controls-stack > * {
  pointer-events: auto;
}

.map-control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch-target);
  height: var(--touch-target);
  padding: 0;
  border-radius: var(--radius-full);
  border: 1px solid rgba(167, 139, 250, 0.38);
  background: rgba(18, 18, 26, 0.94);
  color: var(--color-text-primary, #f4f4f8);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.35));
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}

.map-control-btn:hover:not(:disabled) {
  background: rgba(40, 40, 52, 0.96);
  border-color: rgba(196, 181, 253, 0.5);
}

.map-control-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.map-control-btn svg {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

/* Compass: long-press opens calibration; block mobile selection/callout on SVG */
.map-control-btn--compass {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.map-control-btn--compass svg {
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

.map-control-btn--compass-cal {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.map-control-btn--compass-cal svg {
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

.map-control-btn--traffic.is-on {
  color: #bfdbfe;
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(59, 130, 246, 0.28);
  box-shadow:
    0 0 0 1px rgba(96, 165, 250, 0.28),
    var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.35));
}

.map-control-btn--sat.is-on,
.map-control-btn--traffic.is-on {
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.55);
  background: rgba(123, 77, 181, 0.28);
  box-shadow:
    0 0 0 1px rgba(167, 139, 250, 0.25),
    var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.35));
}

.map-control-btn--loc.is-on {
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(14, 116, 144, 0.22);
}

.map-control-btn--loc.is-denied {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.35);
}

.map-control-btn--traffic.is-missing {
  color: #6e6e7e;
  border-color: rgba(255, 255, 255, 0.1);
  opacity: 0.65;
}

.map-control-btn--pill {
  width: auto;
  min-width: var(--touch-target);
  padding: 0 0.55rem;
  border-radius: var(--radius-lg);
  font-size: 0.5625rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.map-marker-img-icon {
  display: block;
}

/* Raster divIcons (truck + trailers): transparent shell, image + chip below */
.leaflet-div-icon.map-marker-raster-div-icon {
  background: transparent !important;
  border: none !important;
  overflow: visible;
  line-height: 0;
}

.map-marker-raster-root {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 2px;
  line-height: 0;
  pointer-events: none;
  overflow: visible;
  box-sizing: border-box;
  background: transparent;
}

.map-marker-raster-img {
  display: block;
  width: 100%;
  flex: 0 0 auto;
  height: auto;
  max-height: none;
  object-fit: contain;
  pointer-events: none;
  background: transparent;
}

.map-marker-raster-chip {
  flex-shrink: 0;
  margin: 0 5px;
  padding: 2px 4px;
  border-radius: 2.5px;
  text-align: center;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-weight: 800;
  line-height: 1.1;
  color: #f8fafc;
  background: #0f172a;
  border: 0.6px solid rgba(226, 232, 240, 0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-marker-raster-chip--tractor {
  color: #faf5ff;
  background: rgba(91, 33, 182, 0.94);
  border-color: rgba(199, 168, 255, 0.55);
}

.map-marker-raster-chip--trailer {
  color: #ede9fe;
  background: rgba(76, 29, 149, 0.92);
  border-color: rgba(196, 181, 253, 0.45);
}

/* Trailer beacon circle markers — radar wave style */
.map-marker-beacon-div-icon {
  background: transparent !important;
  border: none !important;
  overflow: visible !important;
}

.map-beacon-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  overflow: visible;
}

.map-beacon-circle {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid currentColor;
  box-sizing: border-box;
}

.map-beacon-circle--heavy {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.35);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
}

.map-beacon-circle--light {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.3);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}

.map-beacon-circle::before,
.map-beacon-circle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid currentColor;
  transform: translate(-50%, -50%) scale(1);
  opacity: 0;
}

/* Radar wave 1 */
.map-marker-trailer-pulse-heavy .map-beacon-circle::before {
  animation: radar-wave-heavy 2s cubic-bezier(0, 0.4, 0.6, 1) infinite;
}
.map-marker-trailer-pulse-light .map-beacon-circle::before {
  animation: radar-wave-light 2.2s cubic-bezier(0, 0.4, 0.6, 1) infinite;
}

/* Radar wave 2 — offset by half cycle */
.map-marker-trailer-pulse-heavy .map-beacon-circle::after {
  animation: radar-wave-heavy 2s cubic-bezier(0, 0.4, 0.6, 1) infinite 1s;
}
.map-marker-trailer-pulse-light .map-beacon-circle::after {
  animation: radar-wave-light 2.2s cubic-bezier(0, 0.4, 0.6, 1) infinite 1.1s;
}

@keyframes radar-wave-heavy {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.7;
    border-color: rgba(239, 68, 68, 0.8);
  }
  100% {
    transform: translate(-50%, -50%) scale(3.2);
    opacity: 0;
    border-color: rgba(239, 68, 68, 0);
  }
}

@keyframes radar-wave-light {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.6;
    border-color: rgba(34, 197, 94, 0.75);
  }
  100% {
    transform: translate(-50%, -50%) scale(3);
    opacity: 0;
    border-color: rgba(34, 197, 94, 0);
  }
}

/* Core dot glow pulse */
.map-marker-trailer-pulse-heavy .map-beacon-circle {
  animation: core-glow-heavy 2s ease-in-out infinite;
}
.map-marker-trailer-pulse-light .map-beacon-circle {
  animation: core-glow-light 2.2s ease-in-out infinite;
}

@keyframes core-glow-heavy {
  0%, 100% {
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.5), 0 0 12px rgba(239, 68, 68, 0.2);
  }
  50% {
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.8), 0 0 24px rgba(239, 68, 68, 0.4);
  }
}

@keyframes core-glow-light {
  0%, 100% {
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.45), 0 0 12px rgba(34, 197, 94, 0.18);
  }
  50% {
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.7), 0 0 22px rgba(34, 197, 94, 0.35);
  }
}

/* Bridge standstill — purple pulse (matches trailer radar style) */
.leaflet-marker-icon.map-marker-bridge-pulse-standstill {
  animation: bridge-marker-glow-purple 2s ease-in-out infinite;
  filter: drop-shadow(0 0 4px rgba(167, 139, 250, 0.7));
}

@keyframes bridge-marker-glow-purple {
  0%,
  100% {
    filter: drop-shadow(0 0 4px rgba(167, 139, 250, 0.55))
      drop-shadow(0 0 10px rgba(124, 58, 237, 0.25));
  }
  50% {
    filter: drop-shadow(0 0 10px rgba(196, 181, 253, 0.95))
      drop-shadow(0 0 22px rgba(124, 58, 237, 0.55));
  }
}

@media (prefers-reduced-motion: reduce) {
  .leaflet-marker-icon.map-marker-bridge-pulse-standstill {
    animation: none;
    filter: drop-shadow(0 0 8px rgba(167, 139, 250, 0.75));
  }
  .map-marker-trailer-pulse-heavy .map-beacon-circle,
  .map-marker-trailer-pulse-light .map-beacon-circle {
    animation: none;
  }
  .map-marker-trailer-pulse-heavy .map-beacon-circle::before,
  .map-marker-trailer-pulse-heavy .map-beacon-circle::after,
  .map-marker-trailer-pulse-light .map-beacon-circle::before,
  .map-marker-trailer-pulse-light .map-beacon-circle::after {
    animation: none;
    display: none;
  }
  .map-marker-trailer-pulse-heavy .map-beacon-circle {
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.7), 0 0 16px rgba(239, 68, 68, 0.3);
  }
  .map-marker-trailer-pulse-light .map-beacon-circle {
    box-shadow: 0 0 7px rgba(34, 197, 94, 0.65), 0 0 14px rgba(34, 197, 94, 0.28);
  }
}

/* Focus ring */
.focus-ring:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-bg-base), 0 0 0 4px var(--color-accent-purple);
}

/* Smooth scrolling container */
.scroll-smooth {
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
}

/* Hide scrollbar but keep functionality */
.scroll-hidden::-webkit-scrollbar {
  display: none;
}
.scroll-hidden {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Text utilities */
.text-gradient {
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Animation utilities */
@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-pulse-glow {
  animation: pulse-glow 2s var(--ease-in-out) infinite;
}

.animate-fade-in {
  animation: fade-in var(--duration-slow) var(--ease-out);
}

.animate-slide-up {
  animation: slide-up var(--duration-slow) var(--ease-out);
}

.animate-scale-in {
  animation: scale-in var(--duration-normal) var(--ease-spring);
}

/* Selection styling */
::selection {
  background: var(--color-accent-purple);
  color: white;
}

/* ═══════════════════════════════════════════════════════════════════════════
   iOS ZOOM FIX — prevent auto-zoom on input focus
   Safari zooms when input font-size < 16px; enforce minimum across all inputs
   ═══════════════════════════════════════════════════════════════════════════ */
@supports (-webkit-touch-callout: none) {
  input,
  input[type="text"],
  input[type="password"],
  input[type="email"],
  input[type="number"],
  input[type="tel"],
  input[type="url"],
  input[type="search"],
  input[type="date"],
  input[type="time"],
  input[type="datetime-local"],
  input[type="month"],
  input[type="week"],
  textarea,
  select {
    font-size: 16px !important;
  }
}

/* Invisible scrollbars app-wide */
* {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
*::-webkit-scrollbar {
  display: none;
}
</style>
