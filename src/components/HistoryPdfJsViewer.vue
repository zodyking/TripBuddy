<script setup>
import {
  ref,
  shallowRef,
  watch,
  onUnmounted,
  nextTick,
  defineModel,
} from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const props = defineProps({
  /** Blob object URL — we copy bytes immediately so the URL can be revoked while viewing. */
  pdfUrl: { type: String, required: true },
})

const emit = defineEmits(['load-error'])

/** Parent-controlled zoom (1 = fit width). */
const zoomMult = defineModel('zoomMult', { type: Number, default: 1 })

const loading = ref(true)
const loadError = ref('')
const numPages = ref(0)
const pdf = shallowRef(/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */ (null))

const mainWrapRef = ref(/** @type {HTMLElement | null} */ (null))
const mainCanvasRef = ref(/** @type {HTMLCanvasElement | null} */ (null))

/** Page shown in the main canvas (thumbnails switch this). */
const currentPage = ref(1)

/** CSS pixels: fit-width scale for the active page at zoom 100%. */
const fitScale = ref(1)

/** @type {Map<number, HTMLCanvasElement>} */
const thumbCanvasByPage = new Map()

/** @type {AbortController | null} */
let fetchAbort = null
/** @type {ResizeObserver | null} */
let resizeObs = null

const THUMB_MAX_W = 72

function effectiveMainScale() {
  return fitScale.value * zoomMult.value
}

function setThumbCanvas(pageNum, el) {
  const n = Number(pageNum)
  if (el instanceof HTMLCanvasElement) thumbCanvasByPage.set(n, el)
  else thumbCanvasByPage.delete(n)
}

async function selectThumbPage(/** @type {number} */ p) {
  if (p < 1 || p > numPages.value) return
  currentPage.value = p
  await measureFitScale()
  await renderCurrentPage()
}

async function waitForMainWrap(/** @type {number} */ maxTries = 48) {
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
  const p = Math.min(Math.max(1, currentPage.value), doc.numPages)
  const page = await doc.getPage(p)
  const vp = page.getViewport({ scale: 1 })
  const pad = 12
  const w = Math.max(120, wrap.clientWidth - pad)
  fitScale.value = Math.max(0.2, Math.min(4, w / vp.width))
}

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale
 * @param {boolean} [hiDpi]
 */
async function renderPageToCanvas(page, canvas, scale, hiDpi = true) {
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d')
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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  const task = page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
  })
  await task.promise
}

let renderToken = 0

async function renderCurrentPage() {
  const doc = pdf.value
  const canvas = mainCanvasRef.value
  const p = currentPage.value
  if (!doc || !canvas || numPages.value < 1 || p < 1 || p > numPages.value) return
  const token = ++renderToken
  const scale = effectiveMainScale()
  const page = await doc.getPage(p)
  if (token !== renderToken) return
  await renderPageToCanvas(page, canvas, scale, true)
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

function teardownResizeObserver() {
  resizeObs?.disconnect()
  resizeObs = null
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
      await renderCurrentPage()
    }, 120)
  })
  resizeObs.observe(wrap)
}

function cleanupDoc() {
  teardownResizeObserver()
  if (pdf.value) {
    try {
      pdf.value.destroy()
    } catch {
      /* ignore */
    }
    pdf.value = null
  }
  numPages.value = 0
  currentPage.value = 1
  thumbCanvasByPage.clear()
  renderToken++
}

async function loadFromUrl(url) {
  fetchAbort?.abort()
  fetchAbort = new AbortController()
  cleanupDoc()
  loadError.value = ''
  loading.value = true
  try {
    const res = await fetch(url, { signal: fetchAbort.signal })
    if (!res.ok) throw new Error(`Could not load PDF (${res.status})`)
    const buf = await res.arrayBuffer()
    const task = pdfjsLib.getDocument({ data: buf })
    const doc = await task.promise
    pdf.value = doc
    numPages.value = doc.numPages
    currentPage.value = 1
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

  loading.value = false
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))

  if (!pdf.value || numPages.value < 1) return

  try {
    await measureFitScale()
    setupResizeObserver()
    await nextTick()
    await renderThumbnails()
    await nextTick()
    await renderCurrentPage()
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
  await measureFitScale()
  await renderCurrentPage()
})

onUnmounted(() => {
  fetchAbort?.abort()
  cleanupDoc()
})
</script>

<template>
  <div class="history-pdfjs">
    <div v-if="loadError" class="history-pdfjs-state history-pdfjs-state--err">
      {{ loadError }}
    </div>
    <template v-else>
      <div ref="mainWrapRef" class="history-pdfjs-main">
        <div v-if="loading" class="history-pdfjs-loading" role="status" aria-live="polite">
          Loading PDF…
        </div>
        <template v-else-if="numPages > 0">
          <div class="history-pdfjs-page-shell">
            <canvas ref="mainCanvasRef" class="history-pdfjs-canvas" />
          </div>
        </template>
      </div>
      <div v-if="!loading && numPages > 1" class="history-pdfjs-thumbs" role="tablist" aria-label="Pages">
        <button
          v-for="p in numPages"
          :key="'th-' + p"
          type="button"
          role="tab"
          :aria-selected="p === currentPage"
          class="history-pdfjs-thumb tap"
          :class="{ 'history-pdfjs-thumb--on': p === currentPage }"
          :title="'Page ' + p"
          @click="selectThumbPage(p)"
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

.history-pdfjs-main {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  padding: 0.35rem 0.3rem 0.45rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.history-pdfjs-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  font-size: 0.85rem;
  color: rgba(228, 228, 238, 0.78);
  background: rgba(10, 10, 16, 0.55);
  pointer-events: none;
}

.history-pdfjs-page-shell {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
  border-radius: 2px;
  overflow: hidden;
  line-height: 0;
  flex-shrink: 0;
}

.history-pdfjs-canvas {
  display: block;
}

.history-pdfjs-thumbs {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  gap: 0.4rem;
  padding: 0.35rem 0.4rem calc(0.4rem + env(safe-area-inset-bottom, 0));
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
