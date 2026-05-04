<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'

const props = defineProps({
  videoUrl: {
    type: String,
    default: null,
  },
  imageUrl: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    default: 'Unknown',
  },
  bridgeName: {
    type: String,
    default: 'Bridge',
  },
  fillColumn: {
    type: Boolean,
    default: false,
  },
  youtubeVideoId: {
    type: String,
    default: null,
  },
})

const videoRef = ref(null)
const youtubeWrapRef = ref(null)
const isLoading = ref(true)
const hasError = ref(false)
const errorMsg = ref('')
const usingFallbackImage = ref(false)
let hls = null
let retryCount = 0
let retryTimer = null
let backgroundRetryTimer = null
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 3000
const BACKGROUND_RETRY_MS = 10000

const youtubeEmbedSrc = computed(() => {
  const id = props.youtubeVideoId?.trim()
  if (!id) return ''
  const q = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    controls: '0',
    showinfo: '0',
  })
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}?${q}`
})

const effectiveSource = computed(() => {
  if (props.youtubeVideoId?.trim()) return { type: 'youtube' }
  if (usingFallbackImage.value && props.imageUrl) return { type: 'image', url: props.imageUrl }
  if (props.videoUrl && !hasError.value) return { type: 'video', url: props.videoUrl }
  if (props.imageUrl) return { type: 'image', url: props.imageUrl }
  return null
})

const isDisabled = computed(() => {
  return props.status === 'Disabled' || props.status === 'Blocked'
})

async function loadHls() {
  if (typeof window === 'undefined') return null
  try {
    const { default: Hls } = await import('hls.js')
    return Hls
  } catch {
    return null
  }
}

function tryAutoplay() {
  const video = videoRef.value
  if (!video) return
  video.play().catch(() => {})
}

function scheduleRetry() {
  if (retryCount >= MAX_RETRIES) {
    if (props.imageUrl) {
      usingFallbackImage.value = true
      hasError.value = false
      isLoading.value = false
      scheduleBackgroundRetry()
    }
    return
  }
  retryCount++
  retryTimer = setTimeout(() => {
    initVideo()
  }, RETRY_DELAY_MS)
}

function scheduleBackgroundRetry() {
  clearBackgroundRetryTimer()
  backgroundRetryTimer = setTimeout(() => {
    retryCount = 0
    usingFallbackImage.value = false
    initVideo()
  }, BACKGROUND_RETRY_MS)
}

function clearBackgroundRetryTimer() {
  if (backgroundRetryTimer) {
    clearTimeout(backgroundRetryTimer)
    backgroundRetryTimer = null
  }
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function clearAllTimers() {
  clearRetryTimer()
  clearBackgroundRetryTimer()
}

async function initVideo() {
  if (!props.videoUrl || !videoRef.value) return
  
  isLoading.value = true
  hasError.value = false
  errorMsg.value = ''
  usingFallbackImage.value = false
  
  const video = videoRef.value
  
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = props.videoUrl
    
    const onLoadedMeta = () => {
      isLoading.value = false
      retryCount = 0
      clearBackgroundRetryTimer()
      tryAutoplay()
    }
    const onError = () => {
      hasError.value = true
      errorMsg.value = 'Video playback failed'
      isLoading.value = false
      scheduleRetry()
    }
    
    video.removeEventListener('loadedmetadata', onLoadedMeta)
    video.removeEventListener('error', onError)
    video.addEventListener('loadedmetadata', onLoadedMeta, { once: true })
    video.addEventListener('error', onError, { once: true })
  } else {
    const Hls = await loadHls()
    if (Hls && Hls.isSupported()) {
      destroyHls()
      
      hls = new Hls({
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        maxBufferSize: 2 * 1000 * 1000,
        enableWorker: true,
        lowLatencyMode: false,
        fragLoadingTimeOut: 10000,
        manifestLoadingTimeOut: 10000,
        levelLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 3,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
      })
      
      hls.loadSource(props.videoUrl)
      hls.attachMedia(video)
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        isLoading.value = false
        retryCount = 0
        clearBackgroundRetryTimer()
        tryAutoplay()
      })
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (retryCount < MAX_RETRIES) {
                hls.startLoad()
                retryCount++
              } else {
                hasError.value = true
                errorMsg.value = 'Stream unavailable'
                isLoading.value = false
                destroyHls()
                scheduleRetry()
              }
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError()
              break
            default:
              hasError.value = true
              errorMsg.value = 'Stream unavailable'
              isLoading.value = false
              destroyHls()
              scheduleRetry()
              break
          }
        }
      })
    } else {
      hasError.value = true
      errorMsg.value = 'HLS not supported'
      isLoading.value = false
      if (props.imageUrl) {
        usingFallbackImage.value = true
        hasError.value = false
      }
    }
  }
}

function destroyHls() {
  if (hls) {
    hls.destroy()
    hls = null
  }
}

function enterFullscreen() {
  if (effectiveSource.value?.type === 'youtube' && youtubeWrapRef.value) {
    const el = youtubeWrapRef.value
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    return
  }
  const video = videoRef.value
  if (!video) return
  if (video.requestFullscreen) {
    video.requestFullscreen().catch(() => {})
  } else if (video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen()
  } else if (video.webkitRequestFullscreen) {
    video.webkitRequestFullscreen()
  }
}

function onYoutubeLoad() {
  isLoading.value = false
}

function retryStream() {
  retryCount = 0
  hasError.value = false
  usingFallbackImage.value = false
  clearAllTimers()
  initVideo()
}

watch(() => props.videoUrl, () => {
  clearAllTimers()
  retryCount = 0
  destroyHls()
  if (props.videoUrl && !props.youtubeVideoId?.trim()) {
    initVideo()
  }
})

watch(
  () => props.youtubeVideoId,
  () => {
    clearAllTimers()
    retryCount = 0
    destroyHls()
    if (props.youtubeVideoId?.trim()) {
      isLoading.value = true
      hasError.value = false
      usingFallbackImage.value = false
    } else if (props.videoUrl) {
      initVideo()
    } else {
      isLoading.value = false
    }
  },
)

onMounted(() => {
  if (props.youtubeVideoId?.trim()) {
    isLoading.value = true
  } else if (props.videoUrl) {
    initVideo()
  } else {
    isLoading.value = false
  }
})

onUnmounted(() => {
  clearAllTimers()
  destroyHls()
})
</script>

<template>
  <div class="camera-player" :class="{ 'camera-player--disabled': isDisabled, 'camera-player--fill': fillColumn }">
    <div v-if="isDisabled" class="camera-offline">
      <span class="camera-offline-icon">📷</span>
      <span class="camera-offline-text">Camera offline</span>
    </div>
    
    <template v-else-if="effectiveSource">
      <div
        v-if="effectiveSource.type === 'youtube'"
        ref="youtubeWrapRef"
        class="camera-youtube-wrap"
      >
        <iframe
          v-if="youtubeEmbedSrc"
          class="camera-youtube-iframe"
          :src="youtubeEmbedSrc"
          title="Live bridge camera"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          @load="onYoutubeLoad"
        />
        <div v-if="isLoading" class="camera-loading">
          <span class="camera-loading-spinner" />
        </div>
        <button
          v-if="!isLoading"
          type="button"
          class="camera-fs-btn"
          title="Fullscreen"
          @click="enterFullscreen"
        >
          <svg class="camera-fs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
      <div v-else-if="effectiveSource.type === 'video'" class="camera-video-wrap">
        <video
          ref="videoRef"
          class="camera-video"
          muted
          playsinline
          loop
          :poster="imageUrl || undefined"
        />
        <div v-if="isLoading" class="camera-loading">
          <span class="camera-loading-spinner" />
        </div>
        <div v-if="hasError" class="camera-error">
          <span class="camera-error-icon">⚠</span>
          <span class="camera-error-text">{{ errorMsg }}</span>
          <button type="button" class="camera-retry-btn" @click="retryStream">
            Retry
          </button>
        </div>
        <button
          v-if="!isLoading && !hasError"
          type="button"
          class="camera-fs-btn"
          title="Fullscreen"
          @click="enterFullscreen"
        >
          <svg class="camera-fs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
      
      <div v-else-if="effectiveSource.type === 'image'" class="camera-image-wrap">
        <img
          :src="effectiveSource.url"
          :alt="`${bridgeName} camera`"
          class="camera-image"
          loading="lazy"
        />
        <div v-if="usingFallbackImage && videoUrl" class="camera-fallback-badge">
          <span class="camera-fallback-text">Still image</span>
          <button type="button" class="camera-retry-link" @click="retryStream">Retry stream</button>
        </div>
      </div>
    </template>
    
    <div v-else class="camera-no-feed">
      <span class="camera-no-feed-icon">📷</span>
      <span class="camera-no-feed-text">No camera</span>
    </div>
  </div>
</template>

<style scoped>
.camera-player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #0a0a10;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.camera-player--fill {
  aspect-ratio: unset;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.camera-player--disabled {
  opacity: 0.6;
}

.camera-video-wrap,
.camera-image-wrap,
.camera-youtube-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.camera-youtube-wrap {
  overflow: hidden;
  background: #0a0a10;
}

.camera-youtube-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  transform: scale(1.15);
  transform-origin: center center;
}

.camera-video,
.camera-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.camera-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2;
}

.camera-loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #a78bfa;
  border-radius: 50%;
  animation: cam-spin 0.8s linear infinite;
}

@keyframes cam-spin {
  to { transform: rotate(360deg); }
}

.camera-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  background: rgba(0, 0, 0, 0.6);
  color: #f87171;
}

.camera-error-icon {
  font-size: 1.2rem;
}

.camera-error-text {
  font-size: 0.65rem;
  font-weight: 600;
}

.camera-retry-btn {
  margin-top: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: rgba(127, 29, 29, 0.4);
  color: #fecaca;
  font-size: 0.6rem;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.15s ease;
}

.camera-retry-btn:hover {
  background: rgba(127, 29, 29, 0.6);
}

.camera-fallback-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.45rem;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2;
}

.camera-fallback-text {
  font-size: 0.52rem;
  font-weight: 600;
  color: #9a9ab0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.camera-retry-link {
  border: none;
  background: none;
  color: #a78bfa;
  font-size: 0.52rem;
  font-weight: 650;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.camera-retry-link:hover {
  color: #c4b5fd;
}

.camera-fs-btn {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  z-index: 3;
}

.camera-fs-btn:hover {
  background: rgba(123, 77, 181, 0.7);
}

.camera-fs-icon {
  width: 14px;
  height: 14px;
}

.camera-offline,
.camera-no-feed {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  color: #6a6a78;
}

.camera-offline-icon,
.camera-no-feed-icon {
  font-size: 1.4rem;
  opacity: 0.5;
}

.camera-offline-text,
.camera-no-feed-text {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
