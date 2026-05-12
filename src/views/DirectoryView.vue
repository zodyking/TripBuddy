<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { fetchDirectory, patchDirectoryEntry, saveLocationToDirectory, postDirectoryGeocodeMissing, postDirectoryGeocodeOne } from '../api.js'
import DirectoryMap from '../components/DirectoryMap.vue'
import { useMapVehicleId } from '../composables/useMapVehicleId.js'

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
 *   locationType?: string,
 *   district?: string,
 * }>>} */
const locations = ref([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const expandedId = ref('')
/** Brief “Copied” feedback after copying phone (location id). */
const phoneCopiedForId = ref('')
let phoneCopiedTimer = 0

/** Inline edit: location ID, name, address, phone */
const editingLocationId = ref('')
/** @type {import('vue').Ref<{ locationId: string, locationName: string, address: string, phone: string }>} */
const editForm = ref({
  locationId: '',
  locationName: '',
  address: '',
  phone: '',
})
const detailsSaving = ref(false)
const detailsSaveError = ref('')

/** Manual add location modal state */
const addLocationOpen = ref(false)
const addLocationId = ref('')
const addLocationName = ref('')
const addLocationAddress = ref('')
const addLocationPhone = ref('')
const addLocationSaving = ref(false)
const addLocationError = ref('')

/** True while resolving addresses → coordinates for the directory map (Nominatim). */
const geocodeBusy = ref(false)
/** Snapshot for progress UI (reset when backfill finishes). */
const geocodeInitialMissing = ref(0)
const geocodeRemaining = ref(0)
const GEOCODE_HTTP_BATCH = 20

const geocodeMappedCount = computed(() => {
  const init = geocodeInitialMissing.value
  const rem = geocodeRemaining.value
  if (init <= 0) return 0
  return Math.max(0, Math.min(init, init - rem))
})

const geocodeProgressPct = computed(() => {
  const init = geocodeInitialMissing.value
  if (init <= 0) return 0
  return Math.min(100, Math.round((geocodeMappedCount.value / init) * 100))
})

const geocodeEtaHint = computed(() => {
  if (!geocodeBusy.value) return ''
  const rem = geocodeRemaining.value
  if (rem <= 0) return ''
  const rounds = Math.ceil(rem / GEOCODE_HTTP_BATCH)
  const perRoundSec = GEOCODE_HTTP_BATCH * 1.05 + 2
  const sec = Math.ceil(rounds * perRoundSec)
  if (sec < 120) {
    return `Rough ETA ~${sec}s (addresses are resolved sequentially on the server).`
  }
  const m = Math.max(1, Math.round(sec / 60))
  return `Rough ETA ~${m} min (OpenStreetMap Nominatim allows about one request per second; coordinates are saved so each address is only resolved once).`
})

/**
 * Sort directory entries by numeric location id when possible (312 before 3117).
 * @param {{ locationId: string }} a
 * @param {{ locationId: string }} b
 */
function compareLocationIdNumeric(a, b) {
  const sa = String(a.locationId ?? '').trim()
  const sb = String(b.locationId ?? '').trim()
  const na = parseInt(sa, 10)
  const nb = parseInt(sb, 10)
  const aNum = /^\d+$/.test(sa) && Number.isFinite(na)
  const bNum = /^\d+$/.test(sb) && Number.isFinite(nb)
  if (aNum && bNum && na !== nb) return na - nb
  if (aNum && !bNum) return -1
  if (!aNum && bNum) return 1
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

const filteredLocations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const base =
    !q
      ? [...locations.value]
      : locations.value.filter(
          (loc) =>
            loc.locationName.toLowerCase().includes(q) ||
            loc.abbreviation.toLowerCase().includes(q) ||
            loc.locationId.includes(q) ||
            loc.address.toLowerCase().includes(q),
        )
  base.sort(compareLocationIdNumeric)
  return base
})

/** Locations with valid coordinates for the map (follows search filter). */
const mapPins = computed(() => {
  const out = []
  for (const loc of filteredLocations.value) {
    const lat = loc.latitude != null ? Number(loc.latitude) : NaN
    const lng = loc.longitude != null ? Number(loc.longitude) : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    out.push({
      locationId: String(loc.locationId),
      lat,
      lng,
    })
  }
  return out
})

const needsAddressGeocode = computed(() => {
  for (const loc of locations.value) {
    const addr = String(loc.address ?? '').trim()
    if (!addr) continue
    const lat = loc.latitude != null ? Number(loc.latitude) : NaN
    const lng = loc.longitude != null ? Number(loc.longitude) : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true
  }
  return false
})

const { vehicleId: mapVehicleId } = useMapVehicleId()

const showMapNoCoordsNotice = computed(
  () =>
    !loading.value &&
    !geocodeBusy.value &&
    filteredLocations.value.length > 0 &&
    mapPins.value.length === 0,
)

const showMapGeocodeProgress = computed(
  () =>
    !loading.value &&
    geocodeBusy.value &&
    needsAddressGeocode.value &&
    filteredLocations.value.length > 0,
)

const showDirectoryGeocodeBanner = computed(() => showMapGeocodeProgress.value)

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function onMapSelect(locationId) {
  expandedId.value = locationId
  detailsSaveError.value = ''
  editingLocationId.value = ''
  nextTick(() => {
    document
      .getElementById(`dir-loc-${locationId}`)
      ?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'nearest',
      })
  })
}

/** FedEx logo base64 for vCard PHOTO (loaded from public/FED_EX_LOGO.jpg) */
const vcardFedexLogoB64 = ref('')

/** Load FedEx logo as base64 for vCard on mount */
async function loadFedexLogoForVcard() {
  try {
    const resp = await fetch('/FED_EX_LOGO.jpg')
    if (!resp.ok) return
    const blob = await resp.blob()
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg;base64,')) {
        vcardFedexLogoB64.value = dataUrl.replace('data:image/jpeg;base64,', '')
      }
    }
    reader.readAsDataURL(blob)
  } catch {
    // fallback: no photo
  }
}

/** vCard download district filter: 'ny-metro' | 'ny-metro-northeast' | 'all' */
const vcardDistrictFilter = ref('all')
const vcardDropdownOpen = ref(false)

/**
 * Fold one long vCard line to 75-octet chunks (continuation lines start with space).
 * @param {string} line
 */
function foldVcardContentLine(line) {
  const max = 75
  if (line.length <= max) return [line]
  /** @type {string[]} */
  const out = []
  out.push(line.slice(0, max))
  let rest = line.slice(max)
  while (rest.length > 0) {
    out.push(` ${rest.slice(0, max - 1)}`)
    rest = rest.slice(max - 1)
  }
  return out
}

async function refreshDirectoryListOnly() {
  try {
    const res = await fetchDirectory()
    const raw = res.locations ?? []
    locations.value = [...raw].sort(compareLocationIdNumeric)
  } catch {
    /* keep existing list */
  }
}

let geocodeBackfillRunning = false

async function runDirectoryGeocodeBackfill() {
  if (geocodeBackfillRunning || !needsAddressGeocode.value) return
  geocodeBackfillRunning = true
  geocodeBusy.value = true
  geocodeInitialMissing.value = 0
  geocodeRemaining.value = 0
  try {
    let rem = 1
    for (let i = 0; i < 200 && rem > 0; i++) {
      const r = await postDirectoryGeocodeMissing({
        max: GEOCODE_HTTP_BATCH,
        delayMs: 900,
      })
      rem = typeof r.remaining === 'number' ? r.remaining : 0
      if (typeof r.missingBefore === 'number' && r.missingBefore > 0) {
        geocodeInitialMissing.value = Math.max(geocodeInitialMissing.value, r.missingBefore)
      }
      geocodeRemaining.value = rem
      if (r.updated > 0 || r.processed > 0) {
        await refreshDirectoryListOnly()
      }
      if (rem <= 0) break
      if (r.processed === 0) break
    }
  } catch {
    /* ignore — map stays without pins until next load */
  } finally {
    geocodeBusy.value = false
    geocodeBackfillRunning = false
    geocodeInitialMissing.value = 0
    geocodeRemaining.value = 0
  }
}

/**
 * @param {{ silent?: boolean }} [opts] When `silent` (e.g. auto-refresh poll), skip the loading flag so actions stay enabled.
 */
async function loadDirectory(opts = {}) {
  const silent = opts.silent === true
  if (!silent) loading.value = true
  error.value = ''
  try {
    const res = await fetchDirectory()
    const raw = res.locations ?? []
    locations.value = [...raw].sort(compareLocationIdNumeric)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (!silent) loading.value = false
  }
  if (!error.value) {
    void runDirectoryGeocodeBackfill()
  }
}

function toggleExpand(id) {
  if (expandedId.value === id) {
    expandedId.value = ''
    editingLocationId.value = ''
    return
  }
  expandedId.value = id
  editingLocationId.value = ''
  detailsSaveError.value = ''
}

function startDetailsEdit(loc) {
  editingLocationId.value = loc.locationId
  detailsSaveError.value = ''
  editForm.value = {
    locationId: String(loc.locationId ?? ''),
    locationName: String(loc.locationName ?? ''),
    address: String(loc.address ?? ''),
    phone: String(loc.phone ?? ''),
  }
}

function cancelDetailsEdit() {
  editingLocationId.value = ''
  detailsSaveError.value = ''
}

async function saveDetailsEdit(loc) {
  const oldId = loc.locationId
  const nextId = editForm.value.locationId.trim()
  if (!nextId) {
    detailsSaveError.value = 'Location ID is required'
    return
  }
  if (nextId !== oldId && locations.value.some((l) => l.locationId === nextId)) {
    detailsSaveError.value = 'Location ID already exists'
    return
  }
  detailsSaving.value = true
  detailsSaveError.value = ''
  try {
    const res = await patchDirectoryEntry(oldId, {
      locationId: nextId,
      locationName: editForm.value.locationName.trim(),
      address: editForm.value.address.trim(),
      phone: editForm.value.phone.trim(),
    })
    const entry = res.entry
    if (entry) {
      const idx = locations.value.findIndex((l) => l.locationId === oldId)
      const rest =
        idx >= 0
          ? [...locations.value.slice(0, idx), ...locations.value.slice(idx + 1)]
          : locations.value.filter((l) => l.locationId !== oldId)
      locations.value = [...rest, entry].sort(compareLocationIdNumeric)
      if (expandedId.value === oldId) expandedId.value = entry.locationId
      const addr = String(entry.address ?? '').trim()
      const lat = entry.latitude != null ? Number(entry.latitude) : NaN
      const lng = entry.longitude != null ? Number(entry.longitude) : NaN
      if (addr && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
        try {
          const g = await postDirectoryGeocodeOne(entry.locationId)
          if (g.ok && g.entry) {
            const id = g.entry.locationId
            const ix = locations.value.findIndex((l) => l.locationId === id)
            if (ix >= 0) {
              const copy = [...locations.value]
              copy[ix] = g.entry
              locations.value = copy.sort(compareLocationIdNumeric)
            }
          }
        } catch {
          /* geocode optional */
        }
      }
    }
    editingLocationId.value = ''
  } catch (e) {
    detailsSaveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailsSaving.value = false
  }
}

function digitsOnlyPhone(phone) {
  return String(phone ?? '').replace(/\D/g, '')
}

function openAddLocationModal() {
  addLocationId.value = ''
  addLocationName.value = ''
  addLocationAddress.value = ''
  addLocationPhone.value = ''
  addLocationError.value = ''
  addLocationOpen.value = true
}

function closeAddLocationModal() {
  addLocationOpen.value = false
  addLocationId.value = ''
  addLocationName.value = ''
  addLocationAddress.value = ''
  addLocationPhone.value = ''
  addLocationError.value = ''
}

async function submitAddLocation() {
  const rawId = addLocationId.value.trim()
  const rawName = addLocationName.value.trim()
  if (!rawId) {
    addLocationError.value = 'Location ID is required'
    return
  }
  if (locations.value.some((l) => l.locationId === rawId)) {
    addLocationError.value = 'Location ID already exists'
    return
  }
  addLocationSaving.value = true
  addLocationError.value = ''
  try {
    await saveLocationToDirectory({
      locationId: rawId,
      locationName: rawName,
      abbreviation: '',
      address: addLocationAddress.value.trim(),
      phone: addLocationPhone.value.trim(),
      latitude: null,
      longitude: null,
      timeZone: '',
    })
    if (addLocationAddress.value.trim()) {
      try {
        await postDirectoryGeocodeOne(rawId)
      } catch {
        /* optional */
      }
    }
    await refreshDirectoryListOnly()
    closeAddLocationModal()
  } catch (e) {
    addLocationError.value = e instanceof Error ? e.message : String(e)
  } finally {
    addLocationSaving.value = false
  }
}

/**
 * Copy formatted phone for paste-friendly display (fallback: digits).
 * @param {{ locationId: string, phone?: string }} loc
 */
async function copyPhoneNumber(loc) {
  const raw = loc.phone ?? ''
  const formatted = formatPhone(raw)
  const digits = digitsOnlyPhone(raw)
  const text = formatted || digits
  if (!text) return
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    phoneCopiedForId.value = loc.locationId
    if (typeof window !== 'undefined') {
      window.clearTimeout(phoneCopiedTimer)
      phoneCopiedTimer = window.setTimeout(() => {
        phoneCopiedForId.value = ''
      }, 2000)
    }
  } catch {
    /* ignore */
  }
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

/** E.164-style for vCard TEL (digits only, US 10 → +1). */
function phoneToVcardTel(phone) {
  const d = String(phone).replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  if (d.length >= 8) return `+${d}`
  return ''
}

function escapeVcardText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/**
 * "Bethpage - HD" → "Bethpage"; then remove any remaining dashes / normalize spaces.
 * @param {string} rawName
 */
function sanitizeLocationNameForLabel(rawName) {
  const s = String(rawName ?? '').trim()
  if (!s) return ''
  const beforeDash = s.includes('-') ? s.split('-')[0].trim() : s
  return beforeDash.replace(/-/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * vCard X-ABLabel: `locationId - cleanedName` (e.g. 89 - Woodbridge).
 * @param {{ locationId: string, locationName?: string, abbreviation?: string }} loc
 */
function vcardContactLabel(loc) {
  const id = String(loc.locationId ?? '').trim()
  const namePart = sanitizeLocationNameForLabel(loc.locationName || '')
  if (!id && !namePart) {
    return String(loc.abbreviation || '').trim() || 'Location'
  }
  if (!namePart) return id
  if (!id) return namePart
  return `${id} - ${namePart}`
}

/** Card title: short name only (before first dash, dashes stripped). */
function cardLocationTitle(loc) {
  const n = sanitizeLocationNameForLabel(loc.locationName || '')
  return n || loc.abbreviation || 'Unknown'
}

/**
 * Filter locations by district for vCard export.
 * @param {'ny-metro' | 'ny-metro-northeast' | 'all'} filter
 */
function filterLocationsByDistrict(locs, filter) {
  if (filter === 'all') return locs
  const nyMetroDistricts = ['NEW YORK METRO']
  const northeastDistricts = ['NORTHEAST']
  if (filter === 'ny-metro') {
    return locs.filter((l) => nyMetroDistricts.includes((l.district || '').toUpperCase()))
  }
  if (filter === 'ny-metro-northeast') {
    const allowed = [...nyMetroDistricts, ...northeastDistricts]
    return locs.filter((l) => allowed.includes((l.district || '').toUpperCase()))
  }
  return locs
}

/**
 * Parse address string into vCard ADR components.
 * Address format expected: "street, city, state, zip" or similar
 * @param {string} addr
 * @returns {{ street: string, city: string, state: string, zip: string }}
 */
function parseAddressForVcard(addr) {
  const parts = (addr || '').split(',').map((p) => p.trim())
  if (parts.length >= 4) {
    return { street: parts.slice(0, -3).join(', '), city: parts[parts.length - 3], state: parts[parts.length - 2], zip: parts[parts.length - 1] }
  }
  if (parts.length === 3) {
    return { street: parts[0], city: parts[1], state: '', zip: parts[2] }
  }
  if (parts.length === 2) {
    return { street: parts[0], city: parts[1], state: '', zip: '' }
  }
  return { street: addr, city: '', state: '', zip: '' }
}

/**
 * Single vCard 3.0 with FN FedEx and one TEL + ADR per location (label = id + cleaned name).
 */
function buildDirectoryVcardString() {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'ORG:FedEx;', 'FN:FedEx']
  const b64 = vcardFedexLogoB64.value
  if (b64) {
    lines.push(...foldVcardContentLine(`PHOTO;ENCODING=b:${b64}`))
  }
  let item = 1
  const filtered = filterLocationsByDistrict(locations.value, vcardDistrictFilter.value)
  const sorted = [...filtered].sort(compareLocationIdNumeric)
  for (const loc of sorted) {
    const raw = loc.phone ?? ''
    const tel = phoneToVcardTel(raw)
    const label = vcardContactLabel(loc)
    if (tel) {
      lines.push(`item${item}.TEL:${tel}`)
      lines.push(`item${item}.X-ABLabel:${escapeVcardText(label)}`)
      item += 1
    }
    if (loc.address) {
      const { street, city, state, zip } = parseAddressForVcard(loc.address)
      const adrValue = `;;${escapeVcardText(street)};${escapeVcardText(city)};${escapeVcardText(state)};${escapeVcardText(zip)};`
      lines.push(`item${item}.ADR;type=WORK:${adrValue}`)
      lines.push(`item${item}.X-ABLabel:${escapeVcardText(label)}`)
      item += 1
    }
  }
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

const hasVcardData = computed(() => {
  const filtered = filterLocationsByDistrict(locations.value, vcardDistrictFilter.value)
  for (const loc of filtered) {
    if (phoneToVcardTel(loc.phone ?? '') || loc.address) return true
  }
  return false
})

function downloadDirectoryVcard(filter) {
  if (typeof window === 'undefined') return
  vcardDistrictFilter.value = filter
  vcardDropdownOpen.value = false
  nextTick(() => {
    const body = buildDirectoryVcardString()
    if (!body.includes('item1.')) return
    const blob = new Blob([body], { type: 'text/vcard;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const suffix = filter === 'all' ? '' : filter === 'ny-metro' ? '-ny-metro' : '-ny-metro-northeast'
    a.download = `FedEx-directory-contacts${suffix}.vcf`
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  })
}

/**
 * Landscape + minimum width: map fixed left, list scrolls right (max map area).
 * Portrait / narrow: stacked column with normal page scroll.
 */
const isLandscapeSplit = ref(false)
let splitMql = /** @type {MediaQueryList | null} */ (null)

function updateLandscapeSplit() {
  if (typeof window === 'undefined') return
  isLandscapeSplit.value = window.matchMedia(
    '(orientation: landscape) and (min-width: 700px)',
  ).matches
}

function onSplitMqlChange() {
  updateLandscapeSplit()
}

/** Auto-refresh directory data (replaces manual refresh control). */
let directoryPollTimer = null
const DIRECTORY_POLL_MS = 60_000

onMounted(() => {
  updateLandscapeSplit()
  if (typeof window !== 'undefined' && window.matchMedia) {
    splitMql = window.matchMedia(
      '(orientation: landscape) and (min-width: 700px)',
    )
    splitMql.addEventListener('change', onSplitMqlChange)
  }
  void (async () => {
    await loadDirectory()
    loadFedexLogoForVcard()
  })()
  directoryPollTimer = setInterval(() => {
    void loadDirectory({ silent: true })
  }, DIRECTORY_POLL_MS)
})

onUnmounted(() => {
  if (typeof window !== 'undefined' && phoneCopiedTimer) {
    window.clearTimeout(phoneCopiedTimer)
    phoneCopiedTimer = 0
  }
  if (splitMql) {
    splitMql.removeEventListener('change', onSplitMqlChange)
  }
  if (directoryPollTimer) {
    clearInterval(directoryPollTimer)
    directoryPollTimer = null
  }
})
</script>

<template>
  <div class="directory-view" :class="{ 'is-split': isLandscapeSplit }">
    <div class="directory-map-column">
      <div class="directory-map-shell">
        <DirectoryMap
          :pins="mapPins"
          :highlight-id="expandedId"
          :fill-height="isLandscapeSplit"
          :vehicle-id="mapVehicleId"
          @select="onMapSelect"
        />
      </div>

      <div
        v-if="showMapGeocodeProgress && !isLandscapeSplit"
        class="map-no-coords-notice map-geocode-progress"
        role="status"
        aria-live="polite"
      >
        <div class="spinner map-geocode-spinner" aria-hidden="true" />
        <div class="map-geocode-progress-body">
          <p class="map-geocode-progress-title">
            <strong>Saving map coordinates on the server</strong>
          </p>
          <p v-if="geocodeInitialMissing > 0" class="map-geocode-progress-count">
            {{ geocodeMappedCount }} of {{ geocodeInitialMissing }} addresses with coordinates so far
            <span v-if="geocodeRemaining > 0" class="map-geocode-remain"
              >({{ geocodeRemaining }} left)</span
            >
          </p>
          <p v-else class="map-geocode-progress-count">Starting address lookup…</p>
          <div
            v-if="geocodeInitialMissing > 0"
            class="dir-geocode-meter"
            role="progressbar"
            :aria-valuenow="geocodeProgressPct"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`Geocoding progress ${geocodeProgressPct} percent`"
          >
            <div class="dir-geocode-meter-fill" :style="{ width: `${geocodeProgressPct}%` }" />
          </div>
          <p class="map-geocode-progress-hint">{{ geocodeEtaHint }}</p>
        </div>
      </div>

      <div
        v-else-if="showMapNoCoordsNotice && !isLandscapeSplit"
        class="map-no-coords-notice"
        role="status"
      >
        <svg
          class="map-no-coords-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <p>
          None of these locations have coordinates on the map yet. If an address is
          saved, the app will try to resolve it automatically. You can also open
          <strong>Destination</strong> on the Home dispatch card to load details and
          save coordinates to the directory.
        </p>
      </div>

      <p
        v-else-if="showMapNoCoordsNotice && isLandscapeSplit"
        class="map-split-map-hint"
        role="status"
      >
        No map pins yet — addresses are being resolved or open Destination from a trip to save coordinates.
      </p>
    </div>

    <div class="directory-list-column" :class="{ 'is-scroll-pane': isLandscapeSplit }">
      <div
        class="directory-list-inner"
        :class="{ 'is-scroll-pane': isLandscapeSplit }"
      >
        <header class="directory-list-heading">
          <div class="directory-heading-text">
            <h1 class="directory-title">Directory</h1>
            <p class="directory-subtitle">Updates automatically</p>
            <div
              v-if="showDirectoryGeocodeBanner"
              class="directory-geocode-banner"
              role="status"
              aria-live="polite"
            >
              <span class="directory-geocode-banner-dot" aria-hidden="true" />
              <span class="directory-geocode-banner-text">
                <template v-if="geocodeInitialMissing > 0">
                  Geocoding: {{ geocodeMappedCount }} / {{ geocodeInitialMissing }} saved —
                  {{ geocodeRemaining }} queued
                </template>
                <template v-else> Geocoding addresses… </template>
              </span>
            </div>
          </div>
          <div class="directory-header-actions">
            <button
              type="button"
              class="directory-add-btn tap"
              title="Manually add a location by ID and phone"
              @click="openAddLocationModal"
            >
              + Add
            </button>
            <div v-if="locations.length" class="vcard-dropdown-wrap">
              <button
                type="button"
                class="directory-vcard-btn tap"
                :disabled="loading"
                title="Download contacts as .vcf file"
                @click="vcardDropdownOpen = !vcardDropdownOpen"
              >
                Download contacts
                <svg class="vcard-dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div v-if="vcardDropdownOpen" class="vcard-dropdown-menu">
                <button type="button" class="vcard-dropdown-item tap" @click="downloadDirectoryVcard('ny-metro')">
                  New York Metro only
                </button>
                <button type="button" class="vcard-dropdown-item tap" @click="downloadDirectoryVcard('ny-metro-northeast')">
                  NY Metro + Northeast
                </button>
                <button type="button" class="vcard-dropdown-item tap" @click="downloadDirectoryVcard('all')">
                  All locations
                </button>
              </div>
            </div>
          </div>
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
        :id="'dir-loc-' + loc.locationId"
        :key="loc.locationId"
        class="location-card"
        :class="{
          'is-expanded': expandedId === loc.locationId,
          'is-hub': (loc.locationType || '').toUpperCase() === 'HUB',
        }"
      >
        <button
          type="button"
          class="location-card-header tap"
          @click="toggleExpand(loc.locationId)"
          :aria-expanded="expandedId === loc.locationId"
        >
          <div class="location-main">
            <span class="location-id-chip" aria-hidden="true">{{ loc.locationId }}</span>
            <div class="location-title-stack">
              <div class="location-title-row">
                <span class="location-name">{{ cardLocationTitle(loc) }}</span>
                <span v-if="loc.abbreviation" class="location-abbr">{{ loc.abbreviation }}</span>
                <span v-if="(loc.locationType || '').toUpperCase() === 'HUB'" class="location-hub-badge">HUB</span>
              </div>
              <p v-if="loc.address" class="location-address location-address--header">{{ loc.address }}</p>
            </div>
          </div>
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
          <div v-if="editingLocationId !== loc.locationId" class="details-toolbar">
            <button
              type="button"
              class="details-edit-all-btn tap"
              @click.stop="startDetailsEdit(loc)"
            >
              Edit location
            </button>
          </div>

          <dl v-if="editingLocationId !== loc.locationId" class="details-list">
            <div class="detail-row">
              <dt>Location ID</dt>
              <dd>{{ loc.locationId }}</dd>
            </div>
            <div class="detail-row">
              <dt>Location name</dt>
              <dd>{{ loc.locationName?.trim() || '—' }}</dd>
            </div>
            <div class="detail-row">
              <dt>Address</dt>
              <dd>{{ loc.address?.trim() || '—' }}</dd>
            </div>
            <div class="detail-row detail-row--phone">
              <dt>Phone</dt>
              <dd class="phone-edit-cell">
                <div class="phone-display-row">
                  <button
                    v-if="digitsOnlyPhone(loc.phone)"
                    type="button"
                    class="phone-display phone-copy tap"
                    title="Copy phone number"
                    @click.stop="copyPhoneNumber(loc)"
                  >
                    {{ formatPhone(loc.phone) }}
                    <span v-if="phoneCopiedForId === loc.locationId" class="phone-copied-note"
                      >Copied</span
                    >
                  </button>
                  <span v-else class="phone-display">{{ formatPhone(loc.phone) || '—' }}</span>
                </div>
                <p class="phone-hint">Tap number to copy. Shared directory for everyone.</p>
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

          <form
            v-else
            class="details-edit-form"
            @submit.prevent="saveDetailsEdit(loc)"
          >
            <div class="details-edit-fields">
              <label class="details-edit-label">
                Location ID <span class="required">*</span>
                <input
                  v-model="editForm.locationId"
                  type="text"
                  class="details-edit-input"
                  autocomplete="off"
                  required
                  :aria-label="'Location ID for ' + loc.locationId"
                />
              </label>
              <label class="details-edit-label">
                Location name
                <input
                  v-model="editForm.locationName"
                  type="text"
                  class="details-edit-input"
                  autocomplete="off"
                  placeholder="e.g. Woodbridge"
                />
              </label>
              <label class="details-edit-label">
                Address
                <textarea
                  v-model="editForm.address"
                  class="details-edit-textarea"
                  rows="2"
                  autocomplete="street-address"
                  placeholder="Street, city, state ZIP"
                />
              </label>
              <label class="details-edit-label">
                Phone
                <input
                  v-model="editForm.phone"
                  type="tel"
                  class="details-edit-input"
                  inputmode="tel"
                  autocomplete="tel"
                  placeholder="e.g. (555) 123-4567"
                />
              </label>
            </div>
            <p v-if="detailsSaveError" class="details-save-err" role="alert">{{ detailsSaveError }}</p>
            <div class="details-edit-actions">
              <button
                type="button"
                class="phone-cancel-btn tap"
                :disabled="detailsSaving"
                @click="cancelDetailsEdit"
              >
                Cancel
              </button>
              <button type="submit" class="phone-save-btn tap" :disabled="detailsSaving">
                {{ detailsSaving ? 'Saving…' : 'Save' }}
              </button>
            </div>
            <p class="phone-hint">Updates the shared directory for everyone.</p>
          </form>

          <div v-if="editingLocationId !== loc.locationId" class="detail-actions">
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
              v-if="buildTelHref(loc.phone)"
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
    </div>

    <!-- Add Location Modal -->
    <Teleport to="body">
      <div
        v-if="addLocationOpen"
        class="add-location-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-location-title"
        @click.self="closeAddLocationModal"
      >
        <div class="add-location-modal">
          <h2 id="add-location-title" class="add-location-heading">Add Location</h2>
          <p class="add-location-desc">
            Enter location ID, name, address, and optional phone. Coordinates and other
            fields can fill in when you route to this location from the app.
          </p>
          <form class="add-location-form" @submit.prevent="submitAddLocation">
            <div class="add-location-field">
              <label for="add-loc-id">Location ID <span class="required">*</span></label>
              <input
                id="add-loc-id"
                v-model="addLocationId"
                type="text"
                placeholder="e.g. 89"
                autocomplete="off"
                required
              />
            </div>
            <div class="add-location-field">
              <label for="add-loc-name">Location Name</label>
              <input
                id="add-loc-name"
                v-model="addLocationName"
                type="text"
                placeholder="e.g. Woodbridge"
                autocomplete="off"
              />
            </div>
            <div class="add-location-field">
              <label for="add-loc-address">Address</label>
              <textarea
                id="add-loc-address"
                v-model="addLocationAddress"
                rows="2"
                placeholder="e.g. 6000 Riverside Dr, Keasbey, NJ"
                autocomplete="street-address"
              />
            </div>
            <div class="add-location-field">
              <label for="add-loc-phone">Phone</label>
              <input
                id="add-loc-phone"
                v-model="addLocationPhone"
                type="tel"
                placeholder="e.g. (555) 123-4567"
                autocomplete="off"
              />
            </div>
            <p v-if="addLocationError" class="add-location-error" role="alert">
              {{ addLocationError }}
            </p>
            <div class="add-location-actions">
              <button
                type="button"
                class="add-location-cancel tap"
                :disabled="addLocationSaving"
                @click="closeAddLocationModal"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="add-location-submit tap"
                :disabled="addLocationSaving || !addLocationId.trim()"
              >
                {{ addLocationSaving ? 'Adding...' : 'Add' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.directory-view {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
  flex: 0 0 auto;
  min-height: min-content;
}

.directory-view:not(.is-split) {
  padding-left: max(env(safe-area-inset-left, 0px), var(--space-2, 0.5rem));
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-2, 0.5rem));
}

/* Landscape + wide: map left (most width), list scrolls right — grid keeps map from being squeezed by list content */
.directory-view.is-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, min(42vw, 28rem));
  align-items: stretch;
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
  padding-left: 0;
  padding-right: 0;
}

.directory-map-column {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.directory-view.is-split .directory-map-column {
  min-width: 0;
  border-right: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.directory-map-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.directory-view:not(.is-split) .directory-map-shell {
  flex: none;
}

.directory-list-column {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.directory-view.is-split .directory-list-column {
  overflow-x: hidden;
}

.directory-list-inner {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-3, 0.75rem) 0;
  padding-bottom: var(--space-4, 1rem);
}

.directory-list-inner.is-scroll-pane {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.directory-view.is-split .directory-list-inner {
  padding-top: var(--space-3, 0.75rem);
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-3, 0.75rem));
  padding-left: var(--space-3, 0.75rem);
}

.directory-list-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-4, 1rem);
  flex-shrink: 0;
}

.directory-heading-text {
  min-width: 0;
}

.directory-vcard-btn {
  flex-shrink: 0;
  align-self: flex-start;
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.03em);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(123, 77, 181, 0.35);
  border: 1px solid rgba(123, 77, 181, 0.55);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.directory-vcard-btn:hover:not(:disabled) {
  background: rgba(123, 77, 181, 0.5);
  border-color: rgba(167, 139, 250, 0.65);
}

.directory-vcard-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.directory-header-actions {
  display: flex;
  gap: var(--space-2, 0.5rem);
  flex-shrink: 0;
  align-self: flex-start;
}

.directory-add-btn {
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.03em);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(34, 197, 94, 0.25);
  border: 1px solid rgba(34, 197, 94, 0.45);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.directory-add-btn:hover {
  background: rgba(34, 197, 94, 0.35);
  border-color: rgba(34, 197, 94, 0.65);
}

/* Add Location Modal */
.add-location-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4, 1rem);
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.add-location-modal {
  width: 100%;
  max-width: 22rem;
  padding: var(--space-5, 1.25rem);
  background: var(--color-surface, #1c1c24);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.add-location-heading {
  margin: 0 0 var(--space-2, 0.5rem);
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-bold, 700);
  color: var(--color-text-primary, #f4f4f8);
}

.add-location-desc {
  margin: 0 0 var(--space-4, 1rem);
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-secondary, #9898a8);
  line-height: 1.45;
}

.add-location-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.add-location-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 0.25rem);
}

.add-location-field label {
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #9898a8);
}

.add-location-field label .required {
  color: var(--color-error, #f87171);
}

.add-location-field input,
.add-location-field textarea {
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-base, 1rem);
  color: var(--color-text-primary, #f4f4f8);
  background: var(--color-surface-raised, #22222c);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
  outline: none;
  transition: border-color 0.15s ease;
}

.add-location-field input:focus,
.add-location-field textarea:focus {
  border-color: rgba(123, 77, 181, 0.6);
}

.add-location-field input::placeholder,
.add-location-field textarea::placeholder {
  color: var(--color-text-tertiary, #6e6e7e);
}

.add-location-error {
  margin: 0;
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-error, #f87171);
}

.add-location-actions {
  display: flex;
  gap: var(--space-3, 0.75rem);
  margin-top: var(--space-2, 0.5rem);
}

.add-location-cancel,
.add-location-submit {
  flex: 1;
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--weight-semibold, 600);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.add-location-cancel {
  color: var(--color-text-secondary, #9898a8);
  background: transparent;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
}

.add-location-cancel:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.add-location-submit {
  color: #fff;
  background: rgba(34, 197, 94, 0.5);
  border: 1px solid rgba(34, 197, 94, 0.65);
}

.add-location-submit:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.65);
}

.add-location-submit:disabled,
.add-location-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.directory-title {
  font-size: var(--text-xl, 1.25rem);
  font-weight: var(--weight-bold, 700);
  color: var(--color-text-primary, #f4f4f8);
  margin: 0;
}

.directory-subtitle {
  margin: 0.2rem 0 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-tertiary, #6e6e7e);
  letter-spacing: var(--tracking-wide, 0.025em);
}

.directory-geocode-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  margin-top: var(--space-2, 0.5rem);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(123, 77, 181, 0.12);
  border: 1px solid rgba(123, 77, 181, 0.35);
}

.directory-geocode-banner-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-accent-purple, #7b4db5);
  flex-shrink: 0;
  animation: dir-geocode-pulse 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .directory-geocode-banner-dot {
    animation: none;
  }
}

@keyframes dir-geocode-pulse {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.directory-geocode-banner-text {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #a0a0b0);
  line-height: var(--leading-snug, 1.375);
}

.directory-view.is-split .directory-title {
  font-size: var(--text-lg, 1.125rem);
}

.map-no-coords-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  margin-bottom: var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.directory-view.is-split .map-no-coords-notice {
  margin: 0 var(--space-2, 0.5rem) var(--space-2, 0.5rem);
  flex-shrink: 0;
}

.map-split-map-hint {
  margin: 0 var(--space-2, 0.5rem) var(--space-2, 0.5rem);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  flex-shrink: 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: var(--leading-snug, 1.375);
  color: var(--color-text-tertiary, #6e6e7e);
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.map-no-coords-icon {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  color: var(--color-accent-purple, #7b4db5);
  margin-top: 0.125rem;
}

.map-no-coords-notice p {
  margin: 0;
  font-size: var(--text-sm, 0.875rem);
  line-height: var(--leading-snug, 1.375);
  color: var(--color-text-secondary, #a0a0b0);
}

.map-no-coords-notice strong {
  color: var(--color-text-primary, #f4f4f8);
  font-weight: var(--weight-semibold, 600);
}

.map-geocode-progress .map-geocode-spinner {
  width: 1.25rem;
  height: 1.25rem;
  margin-bottom: 0;
  margin-top: 0.125rem;
  flex-shrink: 0;
}

.map-geocode-progress-body {
  flex: 1;
  min-width: 0;
}

.map-geocode-progress-title {
  margin: 0 0 var(--space-1, 0.25rem);
  font-size: var(--text-sm, 0.875rem);
  line-height: var(--leading-snug, 1.375);
  color: var(--color-text-secondary, #a0a0b0);
}

.map-geocode-progress-count {
  margin: 0 0 var(--space-2, 0.5rem);
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
}

.map-geocode-remain {
  color: var(--color-text-tertiary, #6e6e7e);
  font-weight: var(--weight-medium, 500);
}

.dir-geocode-meter {
  height: 0.5rem;
  border-radius: var(--radius-full, 9999px);
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin-bottom: var(--space-2, 0.5rem);
}

.dir-geocode-meter-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--color-accent-purple, #7b4db5),
    rgba(123, 77, 181, 0.85)
  );
  transition: width 0.35s ease;
}

@media (prefers-reduced-motion: reduce) {
  .dir-geocode-meter-fill {
    transition: none;
  }
}

.map-geocode-progress-hint {
  margin: 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: var(--leading-snug, 1.375);
  color: var(--color-text-tertiary, #6e6e7e);
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
  animation: dir-spin 0.8s linear infinite;
  margin-bottom: var(--space-3, 0.75rem);
}

@keyframes dir-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.045) 0%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--radius-xl, 1rem);
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.location-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.28);
}

.location-card.is-expanded {
  border-color: rgba(123, 77, 181, 0.45);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(123, 77, 181, 0.12);
}

.location-card-header {
  width: 100%;
  display: block;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem) var(--space-2, 0.5rem);
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
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
  flex-wrap: nowrap;
  padding-right: var(--space-6, 1.5rem);
}

.location-title-stack {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.location-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  flex-wrap: wrap;
  min-width: 0;
}

.location-address--header {
  margin: 0;
  padding-right: 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.35;
  word-break: break-word;
}

.location-id-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-bold, 700);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary, #c4c4d4);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md, 0.5rem);
}

.location-name {
  font-size: var(--text-md, 1rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  line-height: 1.3;
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
  padding: 0.45rem var(--space-4, 1rem) 0.65rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}

.details-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-2, 0.5rem);
}

.details-edit-all-btn {
  padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-accent-purple, #b794f6);
  background: rgba(123, 77, 181, 0.2);
  border: 1px solid rgba(123, 77, 181, 0.35);
  border-radius: var(--radius-md, 0.5rem);
}

.details-edit-all-btn:hover {
  background: rgba(123, 77, 181, 0.3);
}

.details-edit-form {
  margin: 0;
  padding: 0.25rem 0 0;
}

.details-edit-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.details-edit-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-secondary, #a0a0b0);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.details-edit-label .required {
  color: #f87171;
}

.details-edit-input,
.details-edit-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-md, 0.5rem);
}

.details-edit-textarea {
  resize: vertical;
  min-height: 2.75rem;
  line-height: 1.4;
}

.details-edit-input:focus,
.details-edit-textarea:focus {
  outline: none;
  border-color: rgba(123, 77, 181, 0.55);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.2);
}

.details-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
  margin-top: var(--space-3, 0.75rem);
}

.details-save-err {
  margin: var(--space-2, 0.5rem) 0 0;
  font-size: var(--text-sm, 0.875rem);
  color: #f87171;
}

.details-list {
  margin: 0;
  padding: 0.25rem 0 0;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(7rem, 30%) minmax(0, 1fr);
  gap: 0.5rem 1rem;
  align-items: baseline;
  padding: 0.28rem 0;
}

.detail-row:first-child {
  padding-top: 0;
}

.detail-row:last-child {
  padding-bottom: 0;
}

.detail-row dt {
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  flex-shrink: 0;
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.02em;
}

.detail-row dd {
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
  margin: 0;
  text-align: left;
  word-break: break-word;
  line-height: 1.35;
}

.detail-row--phone {
  align-items: start;
}

.phone-edit-cell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.22rem;
  text-align: left;
}

.phone-display-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.65rem;
}

.phone-display {
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--weight-semibold, 600);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary, #f4f4f8);
  word-break: break-word;
}

button.phone-copy {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: none;
  font: inherit;
  font-weight: var(--weight-semibold, 600);
  font-variant-numeric: tabular-nums;
  color: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button.phone-copy:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.phone-copied-note {
  font-size: 0.625rem;
  font-weight: var(--weight-semibold, 600);
  color: var(--color-accent-purple, #a78bfa);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.phone-edit-link {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  font-size: 0.6875rem;
  font-weight: var(--weight-semibold, 600);
  color: var(--color-accent-purple, #a78bfa);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.phone-edit-link:hover {
  color: #c4b5fd;
}

.phone-edit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.phone-input {
  flex: 1 1 min(12rem, 100%);
  min-width: 0;
  padding: 0.42rem 0.65rem;
  font-size: var(--text-sm, 0.875rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.5rem);
}

.phone-input:focus {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 1px;
}

.phone-save-btn {
  flex-shrink: 0;
  padding: 0.42rem 0.75rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  background: var(--color-accent-purple, #7b4db5);
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.phone-save-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.phone-cancel-btn {
  flex-shrink: 0;
  padding: 0.42rem 0.65rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #a0a0b0);
  background: transparent;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
}

.phone-cancel-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.phone-hint {
  margin: 0;
  font-size: 0.625rem;
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.3;
}

.phone-save-err {
  margin: 0;
  font-size: var(--text-xs, 0.75rem);
  color: #f87171;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.65rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
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

/* vCard dropdown */
.vcard-dropdown-wrap {
  position: relative;
}

.vcard-dropdown-chevron {
  width: 0.875rem;
  height: 0.875rem;
  margin-left: 0.25rem;
  flex-shrink: 0;
}

.vcard-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  min-width: 180px;
  margin-top: 0.25rem;
  padding: var(--space-1, 0.25rem);
  background: var(--color-glass, rgba(22, 22, 29, 0.95));
  backdrop-filter: blur(var(--blur-lg, 20px));
  -webkit-backdrop-filter: blur(var(--blur-lg, 20px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--radius-lg, 0.75rem);
  box-shadow: var(--shadow-lg, 0 8px 16px rgba(0, 0, 0, 0.4));
}

.vcard-dropdown-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-primary, #f4f4f8);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: var(--transition-colors);
}

.vcard-dropdown-item:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.08));
}

/* Hub card styling */
.location-card.is-hub {
  border: 1px solid var(--color-accent-purple, #7b4db5);
}

.location-card.is-hub .location-card-header {
  background: linear-gradient(135deg, rgba(123, 77, 181, 0.15), rgba(123, 77, 181, 0.05));
}

.location-card.is-hub .location-id-chip {
  background: var(--color-accent-purple, #7b4db5);
  color: white;
}

.location-hub-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  margin-left: 0.375rem;
  font-size: 0.5625rem;
  font-weight: var(--weight-bold, 700);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: white;
  background: linear-gradient(135deg, var(--color-accent-purple, #7b4db5), var(--color-accent-orange, #ff6b1a));
  border-radius: var(--radius-sm, 0.25rem);
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
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }

  .detail-row dt {
    padding-top: 0;
  }

  .detail-actions {
    flex-direction: column;
  }

  .action-btn {
    justify-content: center;
  }
}
</style>
