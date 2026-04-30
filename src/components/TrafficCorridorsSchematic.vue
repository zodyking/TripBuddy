<script setup>
import { computed } from 'vue'
import {
  CORRIDOR_VIEWBOX,
  corridorNodes,
  corridorEdges,
  HEAVY_SPEED_RATIO,
  MIN_FREE_FLOW_MPH,
} from '../traffic/corridorSchema.js'

const props = defineProps({
  /** @type {{ byCorridor?: Record<string, unknown[]>, fetchedAt?: number } | null} */
  payload: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  configError: { type: String, default: '' },
})

/**
 * @param {unknown} pt
 */
function flowHeavy(pt) {
  if (!pt || typeof pt !== 'object' || !('ok' in pt) || !/** @type {{ ok: boolean }} */ (pt).ok) {
    return false
  }
  const o = /** @type {{ flow?: Record<string, unknown> }} */ (pt)
  const f = o.flow
  if (!f || typeof f !== 'object') return false
  if (f.roadClosure === true) return true
  const cur = Number(f.currentSpeed)
  const ff = Number(f.freeFlowSpeed)
  if (!Number.isFinite(cur) || !Number.isFinite(ff) || ff < MIN_FREE_FLOW_MPH) return false
  return cur <= ff * HEAVY_SPEED_RATIO
}

/**
 * @param {unknown} pt
 */
function flowTooltip(pt) {
  if (!pt || typeof pt !== 'object') return ''
  const o = /** @type {{ ok?: boolean, error?: string, flow?: Record<string, unknown>, lat?: number, lng?: number }} */ (
    pt
  )
  if (!o.ok) return o.error ? String(o.error) : 'No data'
  const f = o.flow || {}
  const cur = f.currentSpeed
  const ff = f.freeFlowSpeed
  const delay =
    Number.isFinite(Number(f.currentTravelTime)) && Number.isFinite(Number(f.freeFlowTravelTime))
      ? Math.max(0, Number(f.currentTravelTime) - Number(f.freeFlowTravelTime))
      : null
  const parts = [
    typeof cur === 'number' ? `${cur} mph now` : '',
    typeof ff === 'number' ? `${ff} mph free flow` : '',
    delay != null ? `+${delay}s vs free flow` : '',
    f.roadClosure ? 'Road closed' : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

const segmentsByEdge = computed(() => {
  const by = props.payload?.byCorridor && typeof props.payload.byCorridor === 'object'
    ? /** @type {Record<string, unknown[]>} */ (props.payload.byCorridor)
    : {}
  /** @type {{ edgeId: string, color: string, x1: number, y1: number, x2: number, y2: number, heavy: boolean }[]} */
  const out = []
  for (const edge of corridorEdges) {
    const pts = by[edge.id]
    const path = edge.path
    if (!path || path.length < 2) continue
    for (let i = 0; i < path.length - 1; i++) {
      const sample = Array.isArray(pts) ? pts[i] : undefined
      const heavy = flowHeavy(sample)
      const [x1, y1] = path[i]
      const [x2, y2] = path[i + 1]
      out.push({
        edgeId: edge.id,
        color: heavy ? '#fb7185' : edge.color,
        x1,
        y1,
        x2,
        y2,
        heavy,
        opacity: heavy ? 0.98 : 0.55,
        strokeW: heavy ? 4.25 : 2.85,
      })
    }
  }
  return out
})

const heavyDots = computed(() => {
  const by = props.payload?.byCorridor && typeof props.payload.byCorridor === 'object'
    ? /** @type {Record<string, unknown[]>} */ (props.payload.byCorridor)
    : {}
  /** @type {{ cx: number, cy: number, title: string }[]} */
  const dots = []
  for (const edge of corridorEdges) {
    const pts = by[edge.id]
    const path = edge.path
    if (!path?.length || !Array.isArray(pts)) continue
    const n = Math.min(path.length, pts.length)
    for (let i = 0; i < n; i++) {
      if (!flowHeavy(pts[i])) continue
      const [x, y] = path[i]
      dots.push({
        cx: x,
        cy: y,
        title: `${edge.label}: ${flowTooltip(pts[i])}`,
      })
    }
  }
  return dots
})

const legendEdges = computed(() => corridorEdges.map((e) => ({ id: e.id, label: e.label, color: e.color })))

const fetchedLabel = computed(() => {
  const t = props.payload?.fetchedAt
  if (typeof t !== 'number' || !Number.isFinite(t)) return ''
  try {
    return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
})
</script>

<template>
  <div class="tc-root">
    <header class="tc-head">
      <div>
        <h2 class="tc-h2">Corridor traffic</h2>
        <p class="tc-sub">
          Transit-style schematic · live TomTom flow · warm accent only where speed drops vs free flow
        </p>
      </div>
      <p v-if="fetchedLabel" class="tc-updated">Updated {{ fetchedLabel }}</p>
    </header>

    <p v-if="configError" class="tc-warn" role="status">{{ configError }}</p>
    <p v-else-if="error" class="tc-err" role="alert">{{ error }}</p>
    <p v-else-if="loading && !payload" class="tc-loading" aria-busy="true">Loading traffic…</p>

    <div class="tc-svg-wrap">
      <svg
        class="tc-svg"
        :viewBox="CORRIDOR_VIEWBOX"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="NYC NJ truck corridor schematic"
      >
        <defs>
          <linearGradient id="tc-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0c0a14" />
            <stop offset="45%" stop-color="#080812" />
            <stop offset="100%" stop-color="#050508" />
          </linearGradient>
          <pattern id="tc-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e1b2e" stroke-width="0.35" opacity="0.45" />
          </pattern>
        </defs>

        <rect width="920" height="540" fill="url(#tc-bg)" rx="14" />
        <rect width="920" height="540" fill="url(#tc-grid)" rx="14" opacity="0.55" />
        <rect
          width="916"
          height="536"
          x="2"
          y="2"
          fill="none"
          stroke="rgba(167,139,250,0.12)"
          stroke-width="1"
          rx="12"
        />
        <text x="460" y="26" text-anchor="middle" fill="#475569" font-size="10" font-weight="600" letter-spacing="0.04em">
          NYC · LI · NJ — schematic (not to geographic scale)
        </text>

        <!-- corridors -->
        <g class="tc-lines">
          <line
            v-for="(seg, si) in segmentsByEdge"
            :key="`${seg.edgeId}-${si}`"
            :x1="seg.x1"
            :y1="seg.y1"
            :x2="seg.x2"
            :y2="seg.y2"
            :stroke="seg.color"
            :stroke-width="seg.strokeW"
            :stroke-opacity="seg.opacity"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>

        <g class="tc-lines-heavy" pointer-events="none">
          <line
            v-for="(seg, si) in segmentsByEdge"
            v-show="seg.heavy"
            :key="`h-${seg.edgeId}-${si}`"
            :x1="seg.x1"
            :y1="seg.y1"
            :x2="seg.x2"
            :y2="seg.y2"
            stroke="#fb7185"
            stroke-width="7"
            stroke-opacity="0.22"
            stroke-linecap="round"
          />
        </g>

        <!-- heavy nodes -->
        <g class="tc-heavy-dots">
          <circle
            v-for="(d, di) in heavyDots"
            :key="`hd-${di}`"
            :cx="d.cx"
            :cy="d.cy"
            r="5"
            fill="#fecdd3"
            stroke="#9f1239"
            stroke-width="1"
          >
            <title>{{ d.title }}</title>
          </circle>
        </g>

        <!-- labeled nodes -->
        <g class="tc-nodes">
          <g v-for="n in corridorNodes" :key="n.id">
            <circle
              v-if="n.role === 'hub'"
              :cx="n.x"
              :cy="n.y"
              r="8"
              fill="#0f172a"
              stroke="#cbd5e1"
              stroke-width="1.6"
            />
            <circle
              v-else-if="n.role === 'airport'"
              :cx="n.x"
              :cy="n.y"
              r="7"
              fill="#134e4a"
              stroke="#5eead4"
              stroke-width="1.4"
            />
            <circle
              v-else-if="n.role === 'bridge'"
              :cx="n.x"
              :cy="n.y"
              r="6"
              fill="#1e1b4b"
              stroke="#c4b5fd"
              stroke-width="1.25"
            />
            <circle
              v-else
              :cx="n.x"
              :cy="n.y"
              r="4.5"
              fill="#0f172a"
              stroke="#64748b"
              stroke-width="1"
            />
            <text
              :x="n.x"
              :y="n.y + (n.role === 'hub' ? 20 : 16)"
              text-anchor="middle"
              fill="#94a3b8"
              font-size="8.5"
              font-weight="600"
              font-family="system-ui, sans-serif"
            >{{ n.label }}</text>
          </g>
        </g>

        <!-- route legend -->
        <g class="tc-pills" transform="translate(24, 418)">
          <text x="0" y="-6" fill="#64748b" font-size="8" font-weight="700" letter-spacing="0.08em">
            ROUTES
          </text>
          <g
            v-for="(leg, li) in legendEdges"
            :key="leg.id"
            :transform="`translate(${Math.floor(li / 8) * 132} ${10 + (li % 8) * 16})`"
          >
            <rect x="0" y="-9" width="11" height="11" rx="2" :fill="leg.color" opacity="0.85" />
            <text x="16" y="0" fill="#cbd5e1" font-size="8" font-weight="600">{{ leg.label }}</text>
          </g>
        </g>
      </svg>
    </div>

    <footer class="tc-foot">
      <span class="tc-legend-dot" /> Heavy = current ≤ {{ Math.round(HEAVY_SPEED_RATIO * 100) }}% of free-flow (mph), closures always flagged.
    </footer>
  </div>
</template>

<style scoped>
.tc-root {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  flex: 1 1 auto;
}

.tc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.tc-h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary, #f4f4f8);
}

.tc-sub {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.35;
  max-width: 42rem;
}

.tc-updated {
  margin: 0;
  font-size: 0.68rem;
  color: #8b8b9c;
  font-variant-numeric: tabular-nums;
}

.tc-warn {
  margin: 0;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.35);
  color: #fcd34d;
  font-size: 0.78rem;
}

.tc-err {
  margin: 0;
  color: #fca5a5;
  font-size: 0.85rem;
}

.tc-loading {
  margin: 0;
  color: #9ca3af;
  font-size: 0.85rem;
}

.tc-svg-wrap {
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(167, 139, 250, 0.14);
  background: linear-gradient(165deg, #0a0812 0%, #050508 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 12px 40px rgba(0, 0, 0, 0.35);
}

.tc-svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(58vh, 500px);
}

.tc-foot {
  font-size: 0.65rem;
  color: #6b7280;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.tc-legend-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: #fb7185;
  flex-shrink: 0;
}
</style>
