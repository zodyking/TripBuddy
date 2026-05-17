<script setup>
import {
  ref,
  shallowRef,
  watch,
  onUnmounted,
  nextTick,
} from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const props = defineProps({
  /** Blob object URL — we copy bytes immediately so the URL can be revoked while viewing. */
  pdfUrl: { type: String, required: true },
})

const emit = defineEmits(['load-error'])

const loading = ref(true)
const loadError = ref('')
const numPages = ref(0)
const pdf = shallowRef(/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */ (null))

const mainWrapRef = ref(/** @type {HTMLElement | null} */ (null))
/** CSS pixels: fit-width scale for page 1 at zoom 100%. */
const fitScale = ref(1)
/** User zoom multiplier (1 = fit width). */
const zoomMult = ref(1)
const activePage = ref(1)

/** @type {Map<number, HTMLCanvasElement>} */
const mainCanvasByPage = new Map()
/** @type {Map<number, HTMLCanvasElement>} */
const thumbCanvasByPage = new Map()

/** @type {AbortController | null} */
let fetchAbort = null
/** @type {ResizeObserver | null} */
let resizeObs = null
/** @type {IntersectionObserver | null} */
let pageVisObs = null

function teardownResizeObserver() {
  resizeObs?.disconnect()
  resizeObs = null
}

function teardownPageVisibilityObserver() {
  pageVisObs?.disconnect()
  pageVisObs = null
}

const ZOOM_MIN = 0.55
const ZOOM_MAX = 2.6
const THUMB_MAX_W = 72

function bumpZoom(delta) {
  zoomMult.value = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round((zoomMult.value + delta) * 100) / 100),
  )
}

function resetZoom() {
  zoomMult.value = 1
}

function effectiveMainScale() {
  return fitScale.value * zoomMult.value
}

function setMainCanvas(pageNum, el) {
  const n = Number(pageNum)
  if (el instanceof HTMLCanvasElement) mainCanvasByPage.set(n, el)
  else mainCanvasByPage.delete(n)
}

function setThumbCanvas(pageNum, el) {
  const n = Number(pageNum)
  if (el instanceof HTMLCanvasElement) thumbCanvasByPage.set(n, el)
  else thumbCanvasByPage.delete(n)
}

function scrollToPage(n) {
  const id = `history-pdfjs-page-${n}`
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Wait until the scroll area is mounted (it lives in `v-else`, hidden while `loading` is true). */
async function waitForMainWrap(/** @type {number} */ maxTries = 40) {
  for (let i = 0; i < maxTries; i++) {
    const wrap = mainWrapRef.value
    if (wrap && wrap.clientWidth > 0) return wrap
    await nextTick()
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  }
  return mainWrapRef.value
}

async function measureFitScale() {
  const doc = pdf.value
  const wrap = (await waitForMainWrap()) || mainWrapRef.value
  if (!doc || !wrap || wrap.clientWidth <= 0) return
  const p1 = await doc.getPage(1)
  const vp1 = p1.getViewport({ scale: 1 })
  const pad = 12
  const w = Math.max(120, wrap.clientWidth - pad)
  fitScale.value = Math.max(0.2, Math.min(4, w / vp1.width))
}

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale
 * @param {boolean} [hiDpi]
 */
async function renderPageToCanvas(page, canvas, scale, hiDpi = true) {
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = hiDpi && typeof window !== 'undefined' ? Math.min(2.5, window.devicePixelRatio || 1) : 1
  const w = Math.floor(viewport.width * dpr)
  const h = Math.floor(viewport.height * dpr)
  canvas.width = w
  canvas.height = h
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (dpr !== 1) ctx.scale(dpr, dpr)

  const task = page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
  })
  await task.promise
}

let renderToken = 0
async function renderAllPages() {
  const doc = pdf.value
  const n = numPages.value
  if (!doc || n < 1) return
  const token = ++renderToken
  const scale = effectiveMainScale()

  for (let i = 1; i <= n; i++) {
    if (token !== renderToken) return
    const canvas = mainCanvasByPage.get(i)
    if (!canvas) continue
    const page = await doc.getPage(i)
    if (token !== renderToken) return
    await renderPageToCanvas(page, canvas, scale, true)
  }
}

async function renderThumbnails() {
  const doc = pdf.value
  const n = numPages.value
  if (!doc || n < 1) return
  for (let i = 1; i <= n; i++) {
    const canvas = thumbCanvasByPage.get(i)
    if (!canvas) continue
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const scale = THUMB_MAX_W / vp.width
    await renderPageToCanvas(page, canvas, scale, false)
  }
}

function teardownObservers() {
  teardownResizeObserver()
  teardownPageVisibilityObserver()
}

function setupResizeObserver() {
  teardownResizeObserver()
  const wrap = mainWrapRef.value
  if (!wrap || typeof ResizeObserver === 'undefined') return
  let t = 0
  resizeObs = new ResizeObserver(() => {
    window.clearTimeout(t)
    t = window.setTimeout(async () => {
      await measureFitScale()
      await renderAllPages()
    }, 120)
  })
  resizeObs.observe(wrap)
}

function setupPageVisibilityObserver() {
  pageVisObs?.disconnect()
  const wrap = mainWrapRef.value
  if (!wrap || typeof IntersectionObserver === 'undefined') return
  pageVisObs = new IntersectionObserver(
    (entries) => {
      let best = 0
      let bestPage = activePage.value
      for (const en of entries) {
        const id = en.target.id || ''
        const m = /^history-pdfjs-page-(\d+)$/.exec(id)
        if (!m) continue
        const p = Number(m[1])
        if (en.intersectionRatio > best) {
          best = en.intersectionRatio
          bestPage = p
        }
      }
      if (best > 0.08) activePage.value = bestPage
    },
    { root: wrap, rootMargin: '-32% 0px -38% 0px', threshold: [0, 0.12, 0.25, 0.5, 1] },
  )
  for (let i = 1; i <= numPages.value; i++) {
    const el = typeof document !== 'undefined' ? document.getElementById(`history-pdfjs-page-${i}`) : null
    if (el) pageVisObs.observe(el)
  }
}

function cleanupDoc() {
  teardownObservers()
  if (pdf.value) {
    try {
      pdf.value.destroy()
    } catch {
      /* ignore */
    }
    pdf.value = null
  }
  numPages.value = 0
  mainCanvasByPage.clear()
  thumbCanvasByPage.clear()
  renderToken++
}

async function loadFromUrl(url) {
  fetchAbort?.abort()
  fetchAbort = new AbortController()
  cleanupDoc()
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(url, { signal: fetchAbort.signal })
    if (!res.ok) throw new Error(`Could not load PDF (${res.status})`)
    const buf = await res.arrayBuffer()
    const task = pdfjsLib.getDocument({ data: buf })
    const doc = await task.promise
    pdf.value = doc
    numPages.value = doc.numPages
  } catch (e) {
    if (/** @type {Error} */ (e)?.name === 'AbortError') {
      loading.value = false
      return
    }
    const msg = e instanceof Error ? e.message : 'Could not load PDF'
    loadError.value = msg
    emit('load-error', e)
    cleanupDoc()
    loading.value = false
    return
  }

  /**
   * Canvases live in the same `v-else` branch as the toolbar. While `loading` is true, that branch
   * is not mounted, so we must flip `loading` off before measure/render or all pages stay blank.
   */
  loading.value = false
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))

  if (!pdf.value || numPages.value < 1) return

  try {
    await measureFitScale()
    setupResizeObserver()
    await renderAllPages()
    await nextTick()
    await renderThumbnails()
    await nextTick()
    setupPageVisibilityObserver()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not render PDF'
    loadError.value = msg
    emit('load-error', e)
    cleanupDoc()
  }
}

watch(
  () => props.pdfUrl,
  (url) => {
    if (url) void loadFromUrl(url)
    else {
      fetchAbort?.abort()
      cleanupDoc()
      loading.value = false
      loadError.value = ''
    }
  },
  { immediate: true },
)

watch(zoomMult, async () => {
  if (!pdf.value || numPages.value < 1) return
  await renderAllPages()
})

onUnmounted(() => {
  fetchAbort?.abort()
  cleanupDoc()
})
</script>

<template>
  <div class="history-pdfjs">
    <div v-if="loading" class="history-pdfjs-state" role="status" aria-live="polite">
      Loading PDF…
    </div>
    <div v-else-if="loadError" class="history-pdfjs-state history-pdfjs-state--err">
      {{ loadError }}
    </div>
    <template v-else>
      <div class="history-pdfjs-toolbar" role="toolbar" aria-label="PDF zoom">
        <button
          type="button"
          class="history-pdfjs-tbtn tap"
          aria-label="Zoom out"
          @click="bumpZoom(-0.15)"
        >
          −
        </button>
        <span class="history-pdfjs-zpct">{{ Math.round(zoomMult * 100) }}%</span>
        <button
          type="button"
          class="history-pdfjs-tbtn tap"
          aria-label="Zoom in"
          @click="bumpZoom(0.15)"
        >
          +
        </button>
        <button type="button" class="history-pdfjs-tbtn history-pdfjs-tbtn--txt tap" @click="resetZoom">
          Fit width
        </button>
      </div>
      <div ref="mainWrapRef" class="history-pdfjs-main">
        <div
          v-for="p in numPages"
          :id="'history-pdfjs-page-' + p"
          :key="'pg-' + p"
          class="history-pdfjs-page"
        >
          <canvas :ref="(el) => setMainCanvas(p, el)" class="history-pdfjs-canvas" />
        </div>
      </div>
      <div v-if="numPages > 1" class="history-pdfjs-thumbs" role="tablist" aria-label="Page thumbnails">
        <button
          v-for="p in numPages"
          :key="'th-' + p"
          type="button"
          role="tab"
          :aria-selected="p === activePage"
          class="history-pdfjs-thumb tap"
          :class="{ 'history-pdfjs-thumb--on': p === activePage }"
          :title="'Page ' + p"
          @click="scrollToPage(p)"
        >
          <span class="history-pdfjs-thumb-num">{{ p }}</span>
          <canvas :ref="(el) => setThumbCanvas(p, el)" class="history-pdfjs-thumb-cv" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.history-pdfjs {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0a0a10;
}

.history-pdfjs-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  font-size: 0.85rem;
  color: rgba(228, 228, 238, 0.75);
}

.history-pdfjs-state--err {
  color: #fca5a5;
  text-align: center;
}

.history-pdfjs-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}

.history-pdfjs-tbtn {
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border-radius: 10px;
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.07);
  color: #f4f4fb;
  cursor: pointer;
  touch-action: manipulation;
}

.history-pdfjs-tbtn--txt {
  min-width: auto;
  padding: 0 0.75rem;
  font-size: 0.76rem;
  font-weight: 650;
}

.history-pdfjs-tbtn:hover {
  background: rgba(255, 255, 255, 0.11);
}

.history-pdfjs-tbtn:focus-visible {
  outline: 2px solid rgba(167, 139, 250, 0.75);
  outline-offset: 2px;
}

.history-pdfjs-zpct {
  min-width: 3.25rem;
  text-align: center;
  font-size: 0.76rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.72);
}

.history-pdfjs-main {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  padding: 0.5rem 0.35rem 0.65rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
}

.history-pdfjs-page {
  scroll-margin-top: 6px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
  border-radius: 2px;
  overflow: hidden;
  line-height: 0;
}

.history-pdfjs-canvas {
  display: block;
}

.history-pdfjs-thumbs {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  gap: 0.4rem;
  padding: 0.4rem 0.45rem calc(0.45rem + env(safe-area-inset-bottom, 0));
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 10, 16, 0.96);
}

.history-pdfjs-thumb {
  position: relative;
  flex: 0 0 auto;
  padding: 0.2rem;
  border-radius: 8px;
  border: 2px solid transparent;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  touch-action: manipulation;
}

.history-pdfjs-thumb--on {
  border-color: rgba(167, 139, 250, 0.85);
  background: rgba(167, 139, 250, 0.12);
}

.history-pdfjs-thumb:focus-visible {
  outline: 2px solid rgba(167, 139, 250, 0.75);
  outline-offset: 2px;
}

.history-pdfjs-thumb-num {
  position: absolute;
  top: 2px;
  left: 3px;
  z-index: 1;
  font-size: 0.58rem;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 1px 2px #000;
  pointer-events: none;
}

.history-pdfjs-thumb-cv {
  display: block;
  width: 72px;
  height: auto;
  border-radius: 4px;
  background: #fff;
}
</style>
