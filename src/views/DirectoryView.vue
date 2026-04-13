<script setup>
import { ref, computed, onMounted } from 'vue'
import { fetchDirectory } from '../api.js'

/** @type {import('vue').Ref<Array<{
 *   locationId: string,
 *   locationName: string,
 *   abbreviation: string,
 *   address: string,
 *   phone: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   timeZone: string,
 *   lastUpdated: string,
 * }>>} */
const locations = ref([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const expandedId = ref('')

const filteredLocations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return locations.value
  return locations.value.filter(
    (loc) =>
      loc.locationName.toLowerCase().includes(q) ||
      loc.abbreviation.toLowerCase().includes(q) ||
      loc.locationId.includes(q) ||
      loc.address.toLowerCase().includes(q),
  )
})

async function loadDirectory() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchDirectory()
    locations.value = res.locations ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? '' : id
}

function formatPhone(phone) {
  if (!phone) return ''
  const d = String(phone).replace(/\D/g, '')
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return phone
}

function formatCoordinates(lat, lng) {
  if (lat == null || lng == null) return ''
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`
}

function buildMapsUrl(loc) {
  if (loc.latitude != null && loc.longitude != null) {
    return `https://www.google.com/maps?layer=c&cbll=${loc.latitude},${loc.longitude}`
  }
  if (loc.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`
  }
  return ''
}

function buildTelHref(phone) {
  if (!phone) return ''
  const d = String(phone).replace(/\D/g, '')
  if (d.length === 10) return `tel:+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `tel:+${d}`
  if (d.length >= 8) return `tel:+${d}`
  return ''
}

onMounted(() => {
  loadDirectory()
})
</script>

<template>
  <div class="directory-view">
    <header class="directory-header">
      <h1 class="directory-title">Directory</h1>
      <button
        type="button"
        class="refresh-btn tap"
        :disabled="loading"
        @click="loadDirectory"
        aria-label="Refresh directory"
      >
        <svg
          class="refresh-icon"
          :class="{ 'is-spinning': loading }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </header>

    <div class="search-bar">
      <svg
        class="search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="Search by name, abbreviation, or address..."
        aria-label="Search locations"
      />
      <button
        v-if="searchQuery"
        type="button"
        class="search-clear tap"
        @click="searchQuery = ''"
        aria-label="Clear search"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div v-if="error" class="error-banner">
      <span class="error-icon">!</span>
      <span>{{ error }}</span>
    </div>

    <div v-if="loading && !locations.length" class="loading-state">
      <div class="spinner"></div>
      <p>Loading directory...</p>
    </div>

    <div v-else-if="!locations.length" class="empty-state">
      <svg
        class="empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
      <p class="empty-title">No locations saved yet</p>
      <p class="empty-desc">
        View destination details from trips to build your directory.
      </p>
    </div>

    <div v-else-if="!filteredLocations.length" class="empty-state">
      <svg
        class="empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <p class="empty-title">No results</p>
      <p class="empty-desc">Try a different search term.</p>
    </div>

    <ul v-else class="location-list">
      <li
        v-for="loc in filteredLocations"
        :key="loc.locationId"
        class="location-card"
        :class="{ 'is-expanded': expandedId === loc.locationId }"
      >
        <button
          type="button"
          class="location-card-header tap"
          @click="toggleExpand(loc.locationId)"
          :aria-expanded="expandedId === loc.locationId"
        >
          <div class="location-main">
            <span class="location-name">{{ loc.locationName || 'Unknown' }}</span>
            <span v-if="loc.abbreviation" class="location-abbr">{{ loc.abbreviation }}</span>
          </div>
          <p v-if="loc.address" class="location-address">{{ loc.address }}</p>
          <svg
            class="expand-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div v-if="expandedId === loc.locationId" class="location-details">
          <dl class="details-list">
            <div class="detail-row">
              <dt>Location ID</dt>
              <dd>{{ loc.locationId }}</dd>
            </div>

            <div v-if="loc.phone" class="detail-row">
              <dt>Phone</dt>
              <dd>
                <a :href="buildTelHref(loc.phone)" class="detail-link">
                  {{ formatPhone(loc.phone) }}
                </a>
              </dd>
            </div>

            <div v-if="loc.latitude != null && loc.longitude != null" class="detail-row">
              <dt>Coordinates</dt>
              <dd>{{ formatCoordinates(loc.latitude, loc.longitude) }}</dd>
            </div>

            <div v-if="loc.timeZone" class="detail-row">
              <dt>Time zone</dt>
              <dd>{{ loc.timeZone }}</dd>
            </div>

            <div v-if="loc.lastUpdated" class="detail-row">
              <dt>Last updated</dt>
              <dd>{{ new Date(loc.lastUpdated).toLocaleDateString() }}</dd>
            </div>
          </dl>

          <div class="detail-actions">
            <a
              v-if="buildMapsUrl(loc)"
              :href="buildMapsUrl(loc)"
              target="_blank"
              rel="noopener noreferrer"
              class="action-btn tap"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Open in Maps
            </a>
            <a
              v-if="loc.phone"
              :href="buildTelHref(loc.phone)"
              class="action-btn tap"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              Call
            </a>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="filteredLocations.length" class="location-count">
      {{ filteredLocations.length }} location{{ filteredLocations.length === 1 ? '' : 's' }}
    </p>
  </div>
</template>

<style scoped>
.directory-view {
  padding: var(--space-4, 1rem) 0;
  padding-bottom: calc(var(--space-8, 2rem) + env(safe-area-inset-bottom, 0));
}

.directory-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4, 1rem);
}

.directory-title {
  font-size: var(--text-xl, 1.25rem);
  font-weight: var(--weight-bold, 700);
  color: var(--color-text-primary, #f4f4f8);
  margin: 0;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary, #a0a0b0);
  cursor: pointer;
  transition: var(--transition-colors);
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary, #f4f4f8);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  width: 1.125rem;
  height: 1.125rem;
}

.refresh-icon.is-spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.search-bar {
  position: relative;
  margin-bottom: var(--space-4, 1rem);
}

.search-icon {
  position: absolute;
  left: var(--space-3, 0.75rem);
  top: 50%;
  transform: translateY(-50%);
  width: 1.125rem;
  height: 1.125rem;
  color: var(--color-text-tertiary, #6e6e7e);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: var(--space-3, 0.75rem);
  padding-left: calc(var(--space-3, 0.75rem) + 1.5rem);
  padding-right: calc(var(--space-3, 0.75rem) + 2rem);
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
  outline: none;
  transition: var(--transition-colors);
}

.search-input::placeholder {
  color: var(--color-text-tertiary, #6e6e7e);
}

.search-input:focus {
  border-color: var(--color-accent-purple, #7b4db5);
  background: rgba(255, 255, 255, 0.06);
}

.search-clear {
  position: absolute;
  right: var(--space-2, 0.5rem);
  top: 50%;
  transform: translateY(-50%);
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--color-text-tertiary, #6e6e7e);
  cursor: pointer;
}

.search-clear:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary, #a0a0b0);
}

.search-clear svg {
  width: 1rem;
  height: 1rem;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  padding: var(--space-3, 0.75rem);
  margin-bottom: var(--space-4, 1rem);
  background: var(--color-error-muted, rgba(239, 68, 68, 0.15));
  border: 1px solid var(--color-error-border, rgba(239, 68, 68, 0.3));
  border-radius: var(--radius-md, 0.5rem);
  color: var(--color-error, #ef4444);
  font-size: var(--text-sm, 0.875rem);
}

.error-icon {
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-error, #ef4444);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-bold, 700);
  color: white;
  flex-shrink: 0;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8, 2rem) var(--space-4, 1rem);
  text-align: center;
}

.spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-top-color: var(--color-accent-purple, #7b4db5);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: var(--space-3, 0.75rem);
}

.loading-state p {
  color: var(--color-text-secondary, #a0a0b0);
  font-size: var(--text-sm, 0.875rem);
  margin: 0;
}

.empty-icon {
  width: 3rem;
  height: 3rem;
  color: var(--color-text-tertiary, #6e6e7e);
  margin-bottom: var(--space-3, 0.75rem);
}

.empty-title {
  font-size: var(--text-md, 1rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  margin: 0 0 var(--space-1, 0.25rem);
}

.empty-desc {
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-secondary, #a0a0b0);
  margin: 0;
  max-width: 20rem;
}

.location-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.location-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  transition: var(--transition-colors);
}

.location-card.is-expanded {
  border-color: var(--color-accent-purple-muted, rgba(123, 77, 181, 0.4));
}

.location-card-header {
  width: 100%;
  display: block;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  position: relative;
  -webkit-tap-highlight-color: transparent;
}

.location-card-header:active {
  background: rgba(255, 255, 255, 0.04);
}

.location-main {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  flex-wrap: wrap;
}

.location-name {
  font-size: var(--text-md, 1rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
}

.location-abbr {
  display: inline-flex;
  padding: var(--space-0-5, 0.125rem) var(--space-2, 0.5rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-accent-purple, #7b4db5);
  background: rgba(123, 77, 181, 0.15);
  border-radius: var(--radius-sm, 0.375rem);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.025em);
}

.location-address {
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-secondary, #a0a0b0);
  margin: var(--space-1, 0.25rem) 0 0;
  padding-right: var(--space-6, 1.5rem);
  line-height: var(--leading-snug, 1.375);
}

.expand-chevron {
  position: absolute;
  right: var(--space-3, 0.75rem);
  top: 50%;
  transform: translateY(-50%);
  width: 1.25rem;
  height: 1.25rem;
  color: var(--color-text-tertiary, #6e6e7e);
  transition: transform 0.2s ease;
}

.is-expanded .expand-chevron {
  transform: translateY(-50%) rotate(180deg);
}

.location-details {
  padding: 0 var(--space-4, 1rem) var(--space-4, 1rem);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.details-list {
  margin: 0;
  padding: var(--space-3, 0.75rem) 0;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4, 1rem);
  padding: var(--space-2, 0.5rem) 0;
}

.detail-row:first-child {
  padding-top: 0;
}

.detail-row:last-child {
  padding-bottom: 0;
}

.detail-row dt {
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  flex-shrink: 0;
}

.detail-row dd {
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
  margin: 0;
  text-align: right;
  word-break: break-word;
}

.detail-link {
  color: var(--color-accent-purple, #7b4db5);
  text-decoration: none;
}

.detail-link:hover {
  text-decoration: underline;
}

.detail-actions {
  display: flex;
  gap: var(--space-2, 0.5rem);
  margin-top: var(--space-3, 0.75rem);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5, 0.375rem);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
  text-decoration: none;
  cursor: pointer;
  transition: var(--transition-colors);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.12);
}

.action-btn svg {
  width: 1rem;
  height: 1rem;
}

.location-count {
  text-align: center;
  margin-top: var(--space-4, 1rem);
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

@media (max-width: 374px) {
  .directory-title {
    font-size: var(--text-lg, 1.125rem);
  }

  .location-name {
    font-size: var(--text-sm, 0.875rem);
  }

  .location-address {
    font-size: var(--text-xs, 0.6875rem);
  }

  .detail-row {
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .detail-row dd {
    text-align: left;
  }

  .detail-actions {
    flex-direction: column;
  }

  .action-btn {
    justify-content: center;
  }
}
</style>
