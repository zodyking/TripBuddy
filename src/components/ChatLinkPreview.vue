<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { fetchLinkPreview } from '../api.js'
import { linkPreviewHostname } from '../utils/chatMessageLinks.js'

const props = defineProps({
  url: { type: String, required: true },
})

/** @type {import('vue').Ref<{ title: string, description: string, image: string, siteName: string } | null>} */
const preview = ref(null)
const loading = ref(false)
const failed = ref(false)

let gen = 0

async function load() {
  const url = String(props.url || '').trim()
  if (!url) {
    preview.value = null
    return
  }
  const myGen = ++gen
  loading.value = true
  failed.value = false
  try {
    const r = await fetchLinkPreview(url)
    if (myGen !== gen) return
    if (r?.ok) {
      preview.value = {
        title: String(r.title || '').trim(),
        description: String(r.description || '').trim(),
        image: String(r.image || '').trim(),
        siteName: String(r.siteName || '').trim(),
      }
      failed.value = !preview.value.title && !preview.value.description && !preview.value.image
    } else {
      preview.value = null
      failed.value = true
    }
  } catch {
    if (myGen !== gen) return
    preview.value = null
    failed.value = true
  } finally {
    if (myGen === gen) loading.value = false
  }
}

watch(
  () => props.url,
  () => {
    void load()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  gen++
})
</script>

<template>
  <a
    v-if="url"
    class="chat-link-preview tap"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    @click.stop
  >
    <div v-if="loading" class="chat-link-preview-loading">Loading preview…</div>
    <template v-else-if="preview && !failed">
      <div v-if="preview.image" class="chat-link-preview-image-wrap">
        <img :src="preview.image" class="chat-link-preview-image" alt="" loading="lazy" />
      </div>
      <div class="chat-link-preview-body">
        <p class="chat-link-preview-site">
          {{ preview.siteName || linkPreviewHostname(url) }}
        </p>
        <p v-if="preview.title" class="chat-link-preview-title">{{ preview.title }}</p>
        <p v-if="preview.description" class="chat-link-preview-desc">{{ preview.description }}</p>
      </div>
    </template>
    <div v-else class="chat-link-preview-fallback">
      <span class="chat-link-preview-site">{{ linkPreviewHostname(url) }}</span>
      <span class="chat-link-preview-url">{{ url }}</span>
    </div>
  </a>
</template>

<style scoped>
.chat-link-preview {
  display: block;
  margin-top: 0.35rem;
  border-radius: var(--radius-md, 0.5rem);
  overflow: hidden;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  background: rgba(0, 0, 0, 0.2);
  text-decoration: none;
  color: inherit;
}

.chat-link-preview-loading,
.chat-link-preview-fallback {
  padding: 0.55rem 0.65rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-link-preview-fallback {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.chat-link-preview-url {
  font-size: 0.72rem;
  word-break: break-all;
  opacity: 0.85;
}

.chat-link-preview-image-wrap {
  max-height: 9rem;
  overflow: hidden;
  background: #0a0a0e;
}

.chat-link-preview-image {
  display: block;
  width: 100%;
  max-height: 9rem;
  object-fit: cover;
}

.chat-link-preview-body {
  padding: 0.5rem 0.65rem 0.6rem;
}

.chat-link-preview-site {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-accent-purple-light, #9d6fd7);
}

.chat-link-preview-title {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text-primary, #f4f4f8);
}

.chat-link-preview-desc {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--color-text-secondary, #a8a8b8);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
