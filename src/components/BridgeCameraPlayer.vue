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
})

const videoRef = ref(null)
const isLoading = ref(true)
const hasError = ref(false)
const errorMsg = ref('')
const isPlaying = ref(false)
let hls = null

const effectiveSource = computed(() => {
  if (props.videoUrl) return { type: 'video', url: props.videoUrl }
  if (props.imageUrl) return { type: 'image', url: props.imageUrl }
  return null
})

const isDisabled = computed(() => {
  return props.status === 'Disabled' || props.status === 'Blocked'
})

async function loadHls() {
  if (typeof window === 'undefined') return
  try {
    const { default: Hls } = await import('hls.js')
    return Hls
  } catch {
    return null
  }
}

async function initVideo() {
  if (!props.videoUrl || !videoRef.value) return
  
  isLoading.value = true
  hasError.value = false
  errorMsg.value = ''
  
  const video = videoRef.value
  
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = props.videoUrl
    video.addEventListener('loadedmetadata', () => {
      isLoading.value = false
    })
    video.addEventListener('error', () => {
      hasError.value = true
      errorMsg.value = 'Video playback failed'
      isLoading.value = false
    })
  } else {
    const Hls = await loadHls()
    if (Hls && Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferSize: 1 * 1000 * 1000,
        enableWorker: true,
        lowLatencyMode: false,
      })
      hls.loadSource(props.videoUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        isLoading.value = false
      })
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          hasError.value = true
          errorMsg.value = 'Stream unavailable'
          isLoading.value = false
          hls.destroy()
          hls = null
        }
      })
    } else {
      hasError.value = true
      errorMsg.value = 'HLS not supported'
      isLoading.value = false
    }
  }
}

function destroyHls() {
  if (hls) {
    hls.destroy()
    hls = null
  }
}

function togglePlay() {
  if (!videoRef.value) return
  if (isPlaying.value) {
    videoRef.value.pause()
    isPlaying.value = false
  } else {
    videoRef.value.play().catch(() => {})
    isPlaying.value = true
  }
}

watch(() => props.videoUrl, () => {
  destroyHls()
  if (props.videoUrl) {
    initVideo()
  }
})

onMounted(() => {
  if (props.videoUrl) {
    initVideo()
  } else {
    isLoading.value = false
  }
})

onUnmounted(() => {
  destroyHls()
})
</script>

<template>
  <div class="camera-player" :class="{ 'camera-player--disabled': isDisabled }">
    <div v-if="isDisabled" class="camera-offline">
      <span class="camera-offline-icon">📷</span>
      <span class="camera-offline-text">Camera offline</span>
    </div>
    
    <template v-else-if="effectiveSource">
      <div v-if="effectiveSource.type === 'video'" class="camera-video-wrap">
        <video
          ref="videoRef"
          class="camera-video"
          muted
          playsinline
          loop
          :poster="imageUrl || undefined"
          @click="togglePlay"
        />
        <div v-if="isLoading" class="camera-loading">
          <span class="camera-loading-spinner" />
        </div>
        <div v-if="hasError" class="camera-error">
          <span class="camera-error-icon">⚠</span>
          <span class="camera-error-text">{{ errorMsg }}</span>
        </div>
        <button
          v-if="!isLoading && !hasError"
          type="button"
          class="camera-play-btn"
          :class="{ 'is-playing': isPlaying }"
          @click="togglePlay"
        >
          {{ isPlaying ? '⏸' : '▶' }}
        </button>
      </div>
      
      <div v-else class="camera-image-wrap">
        <img
          :src="effectiveSource.url"
          :alt="`${bridgeName} camera`"
          class="camera-image"
          loading="lazy"
        />
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

.camera-player--disabled {
  opacity: 0.6;
}

.camera-video-wrap,
.camera-image-wrap {
  position: relative;
  width: 100%;
  height: 100%;
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

.camera-play-btn {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.camera-play-btn:hover {
  background: rgba(123, 77, 181, 0.7);
}

.camera-play-btn.is-playing {
  background: rgba(123, 77, 181, 0.5);
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
