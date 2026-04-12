<script setup>
// Root shell: routes render MainDashboard (/) or Settings (/settings).
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
  -webkit-tap-highlight-color: transparent;
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--color-bg-base);
  overflow-x: hidden;
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

/* Invisible scrollbars app-wide */
* {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
*::-webkit-scrollbar {
  display: none;
}
</style>
