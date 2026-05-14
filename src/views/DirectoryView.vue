<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { fetchDirectory, patchDirectoryEntry, saveLocationToDirectory, fetchDirectoryGeocodeStatus, postDirectoryGeocodeOne, getAssignment } from '../api.js'
import DirectoryMap from '../components/DirectoryMap.vue'
import { useMapVehicleId } from '../composables/useMapVehicleId.js'
import {
  DIRECTORY_STATION_TYPES,
  DIRECTORY_LOCATION_TYPE_OTHER,
  filterKeyForLocationType,
  compareDirectoryTypeFilterKeys,
  countByDirectoryLocationType,
} from '../utils/directoryLocationTypes.js'
import { inferRegionFromDirectoryAddress, countryLabelFromCode } from '../utils/directoryAddressRegion.js'
import {
  buildDirectoryVcardString,
  vcardExportHasRenderableItems,
  resolveVcardExportLocations,
  vcardFilenameSuffix,
  sanitizeLocationNameForLabel,
} from '../utils/directoryContactExport.js'
import { countSmartListMatches, SMART_LIST_WINDOW_MS } from '../utils/directoryTripHistorySmartPlaces.js'

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

/** Station types shown on map + list (multi-select). Default matches common dispatch use. */
const DEFAULT_LOCATION_TYPE_FILTER = Object.freeze(['Hub', 'Station'])
const directoryTypeFilterOptions = [...DIRECTORY_STATION_TYPES, DIRECTORY_LOCATION_TYPE_OTHER]
/** @type {import('vue').Ref<string[]>} */
const selectedLocationTypes = ref([...DEFAULT_LOCATION_TYPE_FILTER])

/** ISO-like country codes; empty = all countries. */
/** @type {import('vue').Ref<string[]>} */
const selectedCountryCodes = ref([])
/** `US|NY` style keys; empty = all states/provinces. */
/** @type {import('vue').Ref<string[]>} */
const selectedStateComposites = ref([])

/** @type {import('vue').Ref<'id' | 'name' | 'state' | 'country' | 'type'>} */
const directorySortKey = ref('id')
/** @type {import('vue').Ref<'asc' | 'desc'>} */
const directorySortDir = ref('asc')

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

/** Server-side directory geocoder is running a batch (Nominatim). */
const serverGeocodeInBatch = ref(false)
/** Last reported rows still missing coordinates after the latest server batch. */
const serverGeocodeRemaining = ref(0)
/** How many rows this batch updated (for progress copy). */
const serverGeocodeLastUpdated = ref(0)
/** How many rows this batch attempted. */
const serverGeocodeLastProcessed = ref(0)
const serverGeocodeLastError = ref('')
/** Snapshot “before” count when a server batch starts (for progress bar). */
const geocodeInitialMissing = ref(0)

const geocodeMappedCount = computed(() => {
  const init = geocodeInitialMissing.value
  const rem = serverGeocodeRemaining.value
  if (init <= 0) return 0
  return Math.max(0, Math.min(init, init - rem))
})

const geocodeProgressPct = computed(() => {
  const init = geocodeInitialMissing.value
  if (init <= 0) return 0
  return Math.min(100, Math.round((geocodeMappedCount.value / init) * 100))
})

const geocodeEtaHint = computed(() => {
  if (!serverGeocodeInBatch.value) return ''
  const rem = serverGeocodeRemaining.value
  if (rem <= 0) return ''
  const batch = Math.max(1, serverGeocodeLastProcessed.value || 12)
  const rounds = Math.ceil(rem / batch)
  const intervalSec = 22
  const sec = Math.ceil(rounds * intervalSec * 1.1)
  if (sec < 120) {
    return `Rough ETA ~${sec}s (server resolves about one address per second; check back if you leave this page).`
  }
  const m = Math.max(1, Math.round(sec / 60))
  return `Rough ETA ~${m} min (OpenStreetMap Nominatim rate limits; coordinates persist after each save).`
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

function resetLocationTypeFilter() {
  selectedLocationTypes.value = [...DEFAULT_LOCATION_TYPE_FILTER]
}

/** Keep at least one type when using the multi-select. */
function normalizeLocationTypesFromSelect() {
  if (!selectedLocationTypes.value.length) {
    selectedLocationTypes.value = [...DEFAULT_LOCATION_TYPE_FILTER]
    return
  }
  selectedLocationTypes.value = [...selectedLocationTypes.value].sort(compareDirectoryTypeFilterKeys)
}

function normalizeCountrySelectionFromSelect() {
  selectedCountryCodes.value = [...selectedCountryCodes.value]
    .map((c) => String(c).toUpperCase())
    .sort()
}

function normalizeStateSelectionFromSelect() {
  selectedStateComposites.value = [...selectedStateComposites.value].sort()
}

function resetAllDirectoryFilters() {
  resetLocationTypeFilter()
  selectedCountryCodes.value = []
  selectedStateComposites.value = []
  directorySortKey.value = 'id'
  directorySortDir.value = 'asc'
}

function toggleSortDir() {
  directorySortDir.value = directorySortDir.value === 'asc' ? 'desc' : 'asc'
}

const directoryFiltersDirty = computed(() => {
  const def = [...DEFAULT_LOCATION_TYPE_FILTER]
  const types = [...selectedLocationTypes.value].sort(compareDirectoryTypeFilterKeys)
  const defSorted = [...def].sort(compareDirectoryTypeFilterKeys)
  const typesNonDefault =
    types.length !== defSorted.length || !types.every((t, i) => t === defSorted[i])
  return (
    typesNonDefault ||
    selectedCountryCodes.value.length > 0 ||
    selectedStateComposites.value.length > 0 ||
    directorySortKey.value !== 'id' ||
    directorySortDir.value !== 'asc'
  )
})

/** Filters panel closed by default — compact directory chrome. */
const directoryFiltersPanelOpen = ref(false)
const directoryFiltersShellRef = ref(/** @type {HTMLElement | null} */ (null))
/** @type {((e: MouseEvent) => void) | null} */
let directoryFiltersOutsideClick = null

function removeDirectoryFiltersOutsideClick() {
  if (directoryFiltersOutsideClick && typeof document !== 'undefined') {
    document.removeEventListener('click', directoryFiltersOutsideClick, true)
    directoryFiltersOutsideClick = null
  }
}

watch(directoryFiltersPanelOpen, (open) => {
  removeDirectoryFiltersOutsideClick()
  if (!open || typeof document === 'undefined') return
  void nextTick(() => {
    requestAnimationFrame(() => {
      directoryFiltersOutsideClick = (e) => {
        const shell = directoryFiltersShellRef.value
        const t = e.target
        if (!(t instanceof Node) || !(shell instanceof Element)) return
        if (!shell.contains(t)) {
          directoryFiltersPanelOpen.value = false
          removeDirectoryFiltersOutsideClick()
        }
      }
      document.addEventListener('click', directoryFiltersOutsideClick, true)
    })
  })
})

/** Location type chips: hide “Other” when no rows use that bucket. */
const directoryTypeChips = computed(() => {
  const counts = countByDirectoryLocationType(locationsWithRegion.value)
  return directoryTypeFilterOptions.filter(
    (t) => t !== DIRECTORY_LOCATION_TYPE_OTHER || (counts[DIRECTORY_LOCATION_TYPE_OTHER] ?? 0) > 0,
  )
})

const directorySortKeyShort = computed(() => {
  const k = directorySortKey.value
  if (k === 'id') return 'ID'
  if (k === 'name') return 'Name'
  if (k === 'state') return 'State'
  if (k === 'country') return 'Country'
  if (k === 'type') return 'Type'
  return k
})

/** One-line summary for the collapsed filters control. */
const directoryFiltersTriggerSummary = computed(() => {
  const t = locationTypeFilterSummary.value
  const ord = directorySortDir.value === 'asc' ? 'A→Z' : 'Z→A'
  const s = `${directorySortKeyShort.value} ${ord}`
  if (!selectedCountryCodes.value.length && !selectedStateComposites.value.length) {
    return `${t} · ${s}`
  }
  const bits = [t]
  if (selectedCountryCodes.value.length) {
    bits.push(`${selectedCountryCodes.value.length} countries`)
  }
  if (selectedStateComposites.value.length) {
    bits.push(`${selectedStateComposites.value.length} regions`)
  }
  bits.push(s)
  return bits.join(' · ')
})

const directoryListInnerRef = ref(/** @type {HTMLElement | null} */ (null))
const directoryListHeadingRef = ref(/** @type {HTMLElement | null} */ (null))
/** True while the Directory heading is visible in the scroll viewport (list pane or app scroll). */
const directoryHeadingPinnedVisible = ref(true)
/** @type {IntersectionObserver | null} */
let directoryHeadingIo = null

function directoryFilterScrollRoot() {
  if (typeof document === 'undefined') return null
  return document.querySelector('.app-scroll')
}

function tearDownDirectoryHeadingObserver() {
  if (directoryHeadingIo) {
    directoryHeadingIo.disconnect()
    directoryHeadingIo = null
  }
}

function setupDirectoryHeadingObserver() {
  if (typeof IntersectionObserver === 'undefined') return
  tearDownDirectoryHeadingObserver()
  const heading = directoryListHeadingRef.value
  if (!heading) return
  const inner = directoryListInnerRef.value
  const rootEl =
    isLandscapeSplit.value && inner ? inner : directoryFilterScrollRoot()
  const root = rootEl instanceof Element ? rootEl : null
  directoryHeadingIo = new IntersectionObserver(
    (entries) => {
      const e = entries[0]
      directoryHeadingPinnedVisible.value = !!(e && e.isIntersecting)
    },
    { root, threshold: 0, rootMargin: '0px' },
  )
  directoryHeadingIo.observe(heading)
}

function scrollDirectoryToTop() {
  const inner = directoryListInnerRef.value
  const heading = directoryListHeadingRef.value
  if (isLandscapeSplit.value && inner) {
    inner.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(selectedCountryCodes, (codes) => {
  const set = new Set(codes)
  selectedStateComposites.value = selectedStateComposites.value.filter((comp) => {
    const cc = String(comp).split('|')[0]
    if (!codes.length) return true
    return set.has(cc)
  })
})

/** Short summary of selected location types (hint under type legend). */
const locationTypeFilterSummary = computed(() => {
  const sel = selectedLocationTypes.value
  const all = directoryTypeFilterOptions
  if (sel.length >= all.length) return 'All types'
  const def = [...DEFAULT_LOCATION_TYPE_FILTER]
  if (sel.length === def.length && def.every((t) => sel.includes(t))) {
    return 'Hub + Station'
  }
  return [...sel].sort(compareDirectoryTypeFilterKeys).join(' · ')
})

/**
 * @param {{ locationType?: string }} loc
 */
function locationTypeBadgeText(loc) {
  const key = filterKeyForLocationType(loc.locationType)
  if (key === DIRECTORY_LOCATION_TYPE_OTHER) {
    const raw = String(loc.locationType ?? '').trim()
    if (!raw) return ''
    return raw.length > 22 ? `${raw.slice(0, 20)}…` : raw
  }
  return key
}

/**
 * @param {{ locationType?: string }} loc
 */
function locationTypeBadgeClass(loc) {
  return filterKeyForLocationType(loc.locationType) === 'Hub'
    ? 'location-type-badge--hub'
    : 'location-type-badge--muted'
}

const locationsWithRegion = computed(() => {
  return locations.value.map((loc) => {
    const geo = inferRegionFromDirectoryAddress(loc.address)
    return { ...loc, _geo: geo }
  })
})

const locationsAfterTypeFilter = computed(() => {
  const sel = selectedLocationTypes.value
  return locationsWithRegion.value.filter((loc) => sel.includes(filterKeyForLocationType(loc.locationType)))
})

const locationsAfterCountryFilter = computed(() => {
  const sel = selectedCountryCodes.value
  if (!sel.length) return locationsAfterTypeFilter.value
  const set = new Set(sel)
  return locationsAfterTypeFilter.value.filter((loc) => set.has(loc._geo.countryCode))
})

const locationsAfterGeoFilter = computed(() => {
  const sel = selectedStateComposites.value
  if (!sel.length) return locationsAfterCountryFilter.value
  const set = new Set(sel)
  return locationsAfterCountryFilter.value.filter((loc) => {
    const c = loc._geo.composite
    return c && set.has(c)
  })
})

const countryFacetList = computed(() => {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const loc of locationsAfterTypeFilter.value) {
    const c = loc._geo.countryCode
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([code, count]) => ({
      code,
      count,
      label: countryLabelFromCode(code),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
})

const locationsForStateFacet = computed(() => {
  const tf = locationsAfterTypeFilter.value
  const cc = selectedCountryCodes.value
  if (!cc.length) return tf
  const set = new Set(cc)
  return tf.filter((loc) => set.has(loc._geo.countryCode))
})

const stateFacetList = computed(() => {
  /** @type {Map<string, { composite: string, label: string, count: number }>} */
  const map = new Map()
  for (const loc of locationsForStateFacet.value) {
    const comp = loc._geo.composite
    if (!comp) continue
    const prev = map.get(comp)
    const label = `${loc._geo.stateLabel || loc._geo.stateCode} · ${loc._geo.countryLabel || loc._geo.countryCode}`
    if (prev) {
      prev.count += 1
    } else {
      map.set(comp, { composite: comp, label, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  )
})


/**
 * @param {{ locationId: string, locationName?: string, locationType?: string, _geo: { countryLabel?: string, stateLabel?: string, stateCode?: string, composite?: string } }} a
 * @param {{ locationId: string, locationName?: string, locationType?: string, _geo: { countryLabel?: string, stateLabel?: string, stateCode?: string, composite?: string } }} b
 */
function directorySortCompare(a, b) {
  const key = directorySortKey.value
  const dir = directorySortDir.value === 'desc' ? -1 : 1
  if (key === 'id') {
    return compareLocationIdNumeric(a, b) * dir
  }
  if (key === 'name') {
    const an = String(a.locationName ?? '')
      .trim()
      .localeCompare(String(b.locationName ?? '').trim(), undefined, { sensitivity: 'base' })
    if (an !== 0) return an * dir
    return compareLocationIdNumeric(a, b)
  }
  if (key === 'state') {
    const as = String((a._geo.stateLabel || a._geo.stateCode) ?? '')
      .trim()
      .localeCompare(String((b._geo.stateLabel || b._geo.stateCode) ?? '').trim(), undefined, {
        sensitivity: 'base',
      })
    if (as !== 0) return as * dir
    return compareLocationIdNumeric(a, b)
  }
  if (key === 'country') {
    const ac = String(a._geo.countryLabel ?? '')
      .trim()
      .localeCompare(String(b._geo.countryLabel ?? '').trim(), undefined, { sensitivity: 'base' })
    if (ac !== 0) return ac * dir
    return compareLocationIdNumeric(a, b)
  }
  if (key === 'type') {
    const at = filterKeyForLocationType(a.locationType)
    const bt = filterKeyForLocationType(b.locationType)
    const cmp = compareDirectoryTypeFilterKeys(at, bt)
    if (cmp !== 0) return cmp * dir
    return compareLocationIdNumeric(a, b)
  }
  return compareLocationIdNumeric(a, b)
}

const filteredLocations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  let rows = [...locationsAfterGeoFilter.value]
  if (q) {
    rows = rows.filter(
      (loc) =>
        String(loc.locationName ?? '')
          .toLowerCase()
          .includes(q) ||
        String(loc.abbreviation ?? '')
          .toLowerCase()
          .includes(q) ||
        String(loc.locationId).includes(q) ||
        String(loc.address ?? '')
          .toLowerCase()
          .includes(q) ||
        String(loc._geo.stateLabel ?? '')
          .toLowerCase()
          .includes(q) ||
        String(loc._geo.countryLabel ?? '')
          .toLowerCase()
          .includes(q),
    )
  }
  rows.sort(directorySortCompare)
  return rows
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

/** True when a server batch has finished and counts show an empty queue (clears stale “Saving” UI). */
const geocodeServerQueueComplete = computed(() => {
  const init = geocodeInitialMissing.value
  if (init <= 0) return false
  if (serverGeocodeInBatch.value) return false
  return serverGeocodeRemaining.value <= 0 && geocodeMappedCount.value >= init
})

const showMapNoCoordsNotice = computed(
  () =>
    !loading.value &&
    !serverGeocodeInBatch.value &&
    locationsAfterGeoFilter.value.length > 0 &&
    mapPins.value.length === 0,
)

const showMapGeocodeProgress = computed(
  () =>
    !loading.value &&
    serverGeocodeInBatch.value &&
    !geocodeServerQueueComplete.value &&
    needsAddressGeocode.value &&
    locationsAfterTypeFilter.value.length > 0,
)

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

/** vCard export: `all` | district presets | trip-history smart list (~31 days). */
const vcardScope = ref(/** @type {'all' | 'ny-metro' | 'ny-metro-northeast' | 'smart-31d'} */ ('all'))
/** Sort order inside the exported .vcf (independent from directory list sort). */
const vcardSortKey = ref(/** @type {'id' | 'name' | 'state' | 'country' | 'type' | 'recent-first'} */ ('id'))
const vcardSortDir = ref(/** @type {'asc' | 'desc'} */ ('asc'))
/** `null` = not loaded yet; array (possibly empty) after fetch. */
const tripHistoryLedgerCache = ref(/** @type {unknown[] | null} */ (null))
const tripHistoryLedgerLoading = ref(false)
const vcardDropdownOpen = ref(false)

async function refreshDirectoryListOnly() {
  try {
    const res = await fetchDirectory()
    const raw = res.locations ?? []
    locations.value = [...raw].sort(compareLocationIdNumeric)
  } catch {
    /* keep existing list */
  }
}

async function syncDirectoryGeocodeStatus() {
  if (!needsAddressGeocode.value) {
    serverGeocodeInBatch.value = false
    serverGeocodeRemaining.value = 0
    serverGeocodeLastError.value = ''
    geocodeInitialMissing.value = 0
    return
  }
  try {
    const s = await fetchDirectoryGeocodeStatus()
    const wasBatch = serverGeocodeInBatch.value
    serverGeocodeInBatch.value = Boolean(s.inBatch)
    serverGeocodeRemaining.value =
      typeof s.lastRemaining === 'number' ? s.lastRemaining : 0
    serverGeocodeLastUpdated.value =
      typeof s.lastUpdated === 'number' ? s.lastUpdated : 0
    serverGeocodeLastProcessed.value =
      typeof s.lastProcessed === 'number' ? s.lastProcessed : 0
    serverGeocodeLastError.value =
      typeof s.lastError === 'string' ? s.lastError : ''
    if (serverGeocodeInBatch.value && geocodeInitialMissing.value <= 0) {
      const hint =
        typeof s.lastMissingBefore === 'number' && s.lastMissingBefore > 0
          ? s.lastMissingBefore
          : serverGeocodeRemaining.value
      geocodeInitialMissing.value = Math.max(geocodeInitialMissing.value, hint)
    }
    if (!serverGeocodeInBatch.value && wasBatch) {
      await refreshDirectoryListOnly()
      geocodeInitialMissing.value = 0
    }
    const rem = typeof s.lastRemaining === 'number' ? s.lastRemaining : 0
    if (rem <= 0 && !serverGeocodeInBatch.value) {
      await refreshDirectoryListOnly()
      if (!needsAddressGeocode.value) {
        serverGeocodeLastError.value = ''
        geocodeInitialMissing.value = 0
      }
    }
  } catch {
    /* ignore */
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
    void syncDirectoryGeocodeStatus()
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

/** Card title: short name only (before first dash, dashes stripped). */
function cardLocationTitle(loc) {
  const n = sanitizeLocationNameForLabel(loc.locationName || '')
  return n || loc.abbreviation || 'Unknown'
}

async function ensureTripHistoryLedgerForVcard() {
  if (tripHistoryLedgerCache.value !== null) return
  tripHistoryLedgerLoading.value = true
  try {
    const a = await getAssignment()
    const raw = a?.tripHistoryLedger
    tripHistoryLedgerCache.value = Array.isArray(raw) ? raw : []
  } catch {
    tripHistoryLedgerCache.value = []
  } finally {
    tripHistoryLedgerLoading.value = false
  }
}

const vcardExportLedger = computed(() =>
  Array.isArray(tripHistoryLedgerCache.value) ? tripHistoryLedgerCache.value : [],
)

const vcardExportResolved = computed(() =>
  resolveVcardExportLocations({
    allLocations: locations.value,
    scope: vcardScope.value,
    sortKey: vcardSortKey.value,
    sortDir: vcardSortDir.value,
    ledger: vcardExportLedger.value,
    windowMs: SMART_LIST_WINDOW_MS,
  }),
)

const smartListExportStats = computed(() =>
  countSmartListMatches(vcardExportLedger.value, locations.value, Date.now(), SMART_LIST_WINDOW_MS),
)

const hasVcardData = computed(() => vcardExportHasRenderableItems(vcardExportResolved.value.sorted))

function toggleVcardSortDir() {
  vcardSortDir.value = vcardSortDir.value === 'asc' ? 'desc' : 'asc'
}

watch(vcardDropdownOpen, (open) => {
  if (open) void ensureTripHistoryLedgerForVcard()
})

watch(vcardScope, (s) => {
  if (s === 'smart-31d') {
    vcardSortKey.value = 'recent-first'
    vcardSortDir.value = 'desc'
  } else if (vcardSortKey.value === 'recent-first') {
    vcardSortKey.value = 'id'
    vcardSortDir.value = 'asc'
  }
})

function runDirectoryVcardDownload() {
  if (typeof window === 'undefined') return
  const sorted = vcardExportResolved.value.sorted
  const { body, itemCount } = buildDirectoryVcardString(sorted, {
    photoB64: vcardFedexLogoB64.value,
  })
  if (itemCount <= 0) return
  vcardDropdownOpen.value = false
  nextTick(() => {
    const blob = new Blob([body], { type: 'text/vcard;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `FedEx-directory-contacts${vcardFilenameSuffix(vcardScope.value)}.vcf`
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

watch([isLandscapeSplit, () => locations.value.length], () => {
  void nextTick(() => setupDirectoryHeadingObserver())
})

/** Auto-refresh directory data (replaces manual refresh control). */
let directoryPollTimer = null
const DIRECTORY_POLL_MS = 60_000

/** Poll server geocode worker status (does not start geocoding). */
let geocodeStatusPollTimer = null
const DIRECTORY_GEOCODE_STATUS_POLL_MS = 4000

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
  if (typeof window !== 'undefined') {
    geocodeStatusPollTimer = window.setInterval(() => {
      void (async () => {
        await syncDirectoryGeocodeStatus()
        if (serverGeocodeInBatch.value) {
          await refreshDirectoryListOnly()
        } else if (geocodeServerQueueComplete.value && needsAddressGeocode.value) {
          await refreshDirectoryListOnly()
        }
      })()
    }, DIRECTORY_GEOCODE_STATUS_POLL_MS)
  }
  void nextTick(() => setupDirectoryHeadingObserver())
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
  if (geocodeStatusPollTimer) {
    clearInterval(geocodeStatusPollTimer)
    geocodeStatusPollTimer = null
  }
  tearDownDirectoryHeadingObserver()
  removeDirectoryFiltersOutsideClick()
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
        v-if="showMapNoCoordsNotice && !isLandscapeSplit"
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
          None of these locations have coordinates on the map yet. The server fills in latitude and
          longitude automatically when an address is on file (you do not need to keep this page open).
          If nothing progresses for a long time, set the environment variable
          <strong>NOMINATIM_CONTACT_EMAIL</strong> on the API server to a valid address (OpenStreetMap
          policy). You can also open <strong>Destination</strong> on the Home dispatch card to load details
          and save coordinates to the directory.
        </p>
      </div>

      <p
        v-else-if="showMapNoCoordsNotice && isLandscapeSplit"
        class="map-split-map-hint"
        role="status"
      >
        No map pins yet — the server resolves addresses in the background, or open Destination from a trip to save coordinates.
      </p>
    </div>

    <div class="directory-list-column" :class="{ 'is-scroll-pane': isLandscapeSplit }">
      <div
        ref="directoryListInnerRef"
        class="directory-list-inner"
        :class="{ 'is-scroll-pane': isLandscapeSplit }"
      >
        <header ref="directoryListHeadingRef" class="directory-list-heading">
          <div class="directory-list-heading-top">
            <div class="directory-heading-text">
              <h1 class="directory-title">Directory</h1>
              <p class="directory-subtitle">Updates automatically</p>
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
              <div v-if="locations.length" class="vcard-export-wrap">
                <button
                  type="button"
                  class="directory-vcard-btn tap"
                  :class="{ 'is-open': vcardDropdownOpen }"
                  :disabled="loading"
                  title="Configure and download contacts as a .vcf file"
                  aria-haspopup="dialog"
                  :aria-expanded="vcardDropdownOpen"
                  @click="vcardDropdownOpen = !vcardDropdownOpen"
                >
                  Export contacts
                  <svg class="vcard-dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div
                  v-if="vcardDropdownOpen"
                  class="vcard-export-panel"
                  role="dialog"
                  aria-label="Contact export options"
                  @click.stop
                >
                  <p class="vcard-export-panel-title">Download <span class="vcard-export-mono">.vcf</span></p>
                  <p class="vcard-export-panel-desc">
                    Choose scope, sort order for cards inside the file, then download. Smart list uses your
                    <strong>trip history</strong> (origin &amp; destination numbers) from roughly the
                    <strong>last 31 days</strong>, matched to saved directory IDs.
                  </p>

                  <fieldset class="vcard-export-fieldset">
                    <legend class="vcard-export-legend">Scope</legend>
                    <div class="vcard-export-radios">
                      <label class="vcard-export-radio tap">
                        <input v-model="vcardScope" type="radio" value="all" class="vcard-export-radio-input" />
                        <span>All directory</span>
                      </label>
                      <label class="vcard-export-radio tap">
                        <input v-model="vcardScope" type="radio" value="ny-metro" class="vcard-export-radio-input" />
                        <span>New York Metro <span class="vcard-export-muted">(district)</span></span>
                      </label>
                      <label class="vcard-export-radio tap">
                        <input
                          v-model="vcardScope"
                          type="radio"
                          value="ny-metro-northeast"
                          class="vcard-export-radio-input"
                        />
                        <span>NY Metro + Northeast <span class="vcard-export-muted">(district)</span></span>
                      </label>
                      <label class="vcard-export-radio tap">
                        <input v-model="vcardScope" type="radio" value="smart-31d" class="vcard-export-radio-input" />
                        <span>Smart list <span class="vcard-export-muted">(~31 days)</span></span>
                      </label>
                    </div>
                    <p v-if="vcardScope === 'smart-31d'" class="vcard-export-smart-hint">
                      <template v-if="tripHistoryLedgerLoading">Loading trip history…</template>
                      <template v-else>
                        {{ smartListExportStats.directoryMatches }} directory match(es) from
                        {{ smartListExportStats.historyIds }} recent place id(s) in history.
                      </template>
                    </p>
                  </fieldset>

                  <div class="vcard-export-sort-row">
                    <label class="vcard-export-sort-label" for="vcard-sort-key">Sort in file</label>
                    <select id="vcard-sort-key" v-model="vcardSortKey" class="vcard-export-select tap">
                      <option value="id">Location ID</option>
                      <option value="name">Name</option>
                      <option value="state">State / province</option>
                      <option value="country">Country</option>
                      <option value="type">Location type</option>
                      <option v-if="vcardScope === 'smart-31d'" value="recent-first">Most recent visit</option>
                    </select>
                    <button
                      type="button"
                      class="vcard-export-sort-dir tap"
                      :title="vcardSortDir === 'asc' ? 'Switch to descending' : 'Switch to ascending'"
                      @click="toggleVcardSortDir"
                    >
                      {{ vcardSortDir === 'asc' ? 'A → Z' : 'Z → A' }}
                    </button>
                  </div>

                  <p class="vcard-export-meta">
                    {{ vcardExportResolved.sorted.length }} row(s) in export
                    <span v-if="!hasVcardData" class="vcard-export-warn"> — add phone or address for at least one row</span>
                  </p>

                  <div class="vcard-export-actions">
                    <button
                      type="button"
                      class="vcard-export-download tap"
                      :disabled="!hasVcardData || loading"
                      @click="runDirectoryVcardDownload"
                    >
                      Download .vcf
                    </button>
                    <button type="button" class="vcard-export-cancel tap" @click="vcardDropdownOpen = false">Close</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            v-if="showMapGeocodeProgress"
            class="directory-geocode-status map-geocode-progress"
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
                <span v-if="serverGeocodeRemaining > 0" class="map-geocode-remain"
                  >({{ serverGeocodeRemaining }} left)</span
                >
              </p>
              <p v-else class="map-geocode-progress-count">Resolving addresses on the server…</p>
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
              <p v-if="serverGeocodeLastProcessed > 0" class="map-geocode-progress-batch">
                This batch: {{ serverGeocodeLastUpdated }} saved · {{ serverGeocodeLastProcessed }} looked up
              </p>
              <p v-if="serverGeocodeLastError" class="map-geocode-progress-warn">{{ serverGeocodeLastError }}</p>
              <p class="map-geocode-progress-hint">{{ geocodeEtaHint }}</p>
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

    <section
      v-if="locations.length"
      class="directory-filters directory-filters--dropdown"
      :class="{ 'is-open': directoryFiltersPanelOpen }"
      aria-label="Directory filters and sort"
    >
      <div ref="directoryFiltersShellRef" class="directory-filters-shell">
        <button
          id="directory-filters-trigger"
          type="button"
          class="directory-filters-trigger tap"
          :aria-expanded="directoryFiltersPanelOpen"
          aria-controls="directory-filters-panel"
          @click="directoryFiltersPanelOpen = !directoryFiltersPanelOpen"
        >
          <span class="directory-filters-trigger-main">
            <span class="directory-filters-trigger-title">Filters &amp; sort</span>
            <span
              v-if="directoryFiltersDirty"
              class="directory-filters-dirty-dot"
              aria-hidden="true"
              title="Non-default filters"
            />
          </span>
          <span class="directory-filters-trigger-summary">{{ directoryFiltersTriggerSummary }}</span>
          <svg
            class="directory-filters-trigger-chevron"
            :class="{ 'is-open': directoryFiltersPanelOpen }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div
          id="directory-filters-panel"
          v-show="directoryFiltersPanelOpen"
          class="directory-filters-panel"
          role="region"
          aria-labelledby="directory-filters-trigger"
          @click.stop
        >
          <p class="directory-filters-desc directory-filters-desc--panel">
            Use the lists below (multi-select). Empty country or region lists mean <strong>all</strong> in scope.
            Sort applies after search.
          </p>
          <div class="directory-filters-toolbar">
            <div class="directory-sort-control">
              <label for="directory-sort-key" class="directory-sort-label">Sort</label>
              <select
                id="directory-sort-key"
                v-model="directorySortKey"
                class="directory-sort-select tap"
              >
                <option value="id">Location ID</option>
                <option value="name">Name</option>
                <option value="state">State / province</option>
                <option value="country">Country</option>
                <option value="type">Location type</option>
              </select>
              <button
                type="button"
                class="directory-sort-dir tap"
                :title="directorySortDir === 'asc' ? 'Switch to descending' : 'Switch to ascending'"
                :aria-label="directorySortDir === 'asc' ? 'Sort descending' : 'Sort ascending'"
                @click="toggleSortDir"
              >
                {{ directorySortDir === 'asc' ? 'A → Z' : 'Z → A' }}
              </button>
            </div>
            <button
              v-if="directoryFiltersDirty"
              type="button"
              class="directory-filters-clear tap"
              @click="resetAllDirectoryFilters"
            >
              Clear filters
            </button>
          </div>

          <div class="directory-filters-select-stack">
            <div class="directory-filters-select-field">
              <label for="directory-filter-loc-type" class="directory-filters-field-label">Location type</label>
              <p class="directory-filters-field-hint">{{ locationTypeFilterSummary }}</p>
              <select
                id="directory-filter-loc-type"
                v-model="selectedLocationTypes"
                class="directory-filter-multiselect tap"
                multiple
                :size="Math.min(8, Math.max(3, directoryTypeChips.length))"
                aria-describedby="directory-filter-ms-help"
                @change="normalizeLocationTypesFromSelect"
              >
                <option v-for="t in directoryTypeChips" :key="t" :value="t">{{ t }}</option>
              </select>
              <p id="directory-filter-ms-help" class="directory-filters-micro-hint">
                Multi-select: Ctrl or ⌘ while tapping options (where supported). At least one type stays selected.
              </p>
              <button type="button" class="directory-filters-text-btn tap" @click="resetLocationTypeFilter">
                Use Hub + Station only
              </button>
            </div>

            <div v-if="countryFacetList.length" class="directory-filters-select-field">
              <label for="directory-filter-country" class="directory-filters-field-label">Country</label>
              <p class="directory-filters-field-hint">None selected = all countries for the current types.</p>
              <select
                id="directory-filter-country"
                v-model="selectedCountryCodes"
                class="directory-filter-multiselect tap"
                multiple
                :size="Math.min(6, Math.max(3, countryFacetList.length))"
                @change="normalizeCountrySelectionFromSelect"
              >
                <option v-for="row in countryFacetList" :key="row.code" :value="row.code">
                  {{ row.label }} ({{ row.count }})
                </option>
              </select>
            </div>

            <div v-if="stateFacetList.length" class="directory-filters-select-field">
              <label for="directory-filter-region" class="directory-filters-field-label">State / province</label>
              <p class="directory-filters-field-hint">None selected = all regions for the current type and country scope.</p>
              <select
                id="directory-filter-region"
                v-model="selectedStateComposites"
                class="directory-filter-multiselect tap"
                multiple
                :size="Math.min(10, Math.max(4, stateFacetList.length))"
                @change="normalizeStateSelectionFromSelect"
              >
                <option v-for="row in stateFacetList" :key="row.composite" :value="row.composite">
                  {{ row.label }} ({{ row.count }})
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </section>

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

    <div v-else-if="!locationsAfterTypeFilter.length" class="empty-state">
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
      <p class="empty-title">No locations for these types</p>
      <p class="empty-desc">
        Open <strong>Filters &amp; sort</strong> and select more <strong>location types</strong>, or use
        <strong>Use Hub + Station only</strong> as a starting point.
      </p>
    </div>

    <div v-else-if="!locationsAfterGeoFilter.length" class="empty-state">
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
      <p class="empty-title">No locations match country or state filters</p>
      <p class="empty-desc">
        Open <strong>Filters &amp; sort</strong> and clear <strong>country</strong> or <strong>state / province</strong> chips,
        or tap <strong>Clear filters</strong> inside that panel to restore defaults.
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
      <p class="empty-desc">Try a different search term or clear the search box.</p>
    </div>

    <ul v-else class="location-list">
      <li
        v-for="loc in filteredLocations"
        :id="'dir-loc-' + loc.locationId"
        :key="loc.locationId"
        class="location-card"
        :class="{
          'is-expanded': expandedId === loc.locationId,
          'is-hub': filterKeyForLocationType(loc.locationType) === 'Hub',
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
                <span
                  v-if="locationTypeBadgeText(loc)"
                  class="location-type-badge"
                  :class="locationTypeBadgeClass(loc)"
                >{{ locationTypeBadgeText(loc) }}</span>
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
              <dt>Station type</dt>
              <dd>{{ loc.locationType?.trim() || '—' }}</dd>
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
      <span
        v-if="locations.length !== filteredLocations.length || searchQuery.trim()"
        class="location-count-hint"
      >
        ({{ locations.length }} saved · {{ locationsAfterGeoFilter.length }} after type &amp; region filters<template
          v-if="searchQuery.trim() && filteredLocations.length !== locationsAfterGeoFilter.length"
          > · {{ filteredLocations.length }} match search</template
        >)
      </span>
    </p>
      </div>

      <button
        v-if="locations.length"
        v-show="!directoryHeadingPinnedVisible"
        type="button"
        class="directory-back-top tap"
        aria-label="Back to top"
        @click="scrollDirectoryToTop"
      >
        Back to top
      </button>
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
  padding-bottom: 0;
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
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-4, 1rem);
  flex-shrink: 0;
}

.directory-list-heading-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3, 0.75rem);
}

.directory-heading-text {
  min-width: 0;
  flex: 1;
}

.directory-vcard-btn {
  display: inline-flex;
  align-items: center;
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

.directory-vcard-btn.is-open {
  background: rgba(123, 77, 181, 0.52);
  border-color: rgba(196, 181, 253, 0.75);
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

/* Geocode progress lives only in the list header (not duplicated under the map). */
.directory-geocode-status.map-geocode-progress {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 var(--space-3, 0.75rem);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  background: rgba(123, 77, 181, 0.1);
  border: 1px solid rgba(123, 77, 181, 0.28);
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

.map-geocode-progress-batch {
  margin: 0.35rem 0 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: var(--leading-snug, 1.375);
  color: rgba(196, 181, 253, 0.95);
}

.map-geocode-progress-warn {
  margin: 0.35rem 0 0;
  font-size: 0.65rem;
  line-height: 1.35;
  color: #fcd34d;
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

.directory-filters.directory-filters--dropdown {
  position: relative;
  z-index: 24;
  margin-bottom: var(--space-2, 0.5rem);
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.directory-filters-shell {
  position: relative;
}

.directory-filters--dropdown .directory-filters-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-3, 0.75rem);
  width: 100%;
  margin: 0;
  padding: 0.625rem 1rem;
  min-height: 2.875rem;
  text-align: left;
  font: inherit;
  color: var(--color-text-primary, #f4f4f8);
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: rgba(22, 21, 28, 0.96);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 4px 18px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}

.directory-filters--dropdown.is-open .directory-filters-trigger {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: rgba(255, 255, 255, 0.05);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

.directory-filters--dropdown .directory-filters-trigger:hover {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(28, 26, 34, 0.98);
}

.directory-filters--dropdown .directory-filters-trigger:focus-visible {
  outline: 2px solid rgba(123, 77, 181, 0.55);
  outline-offset: 2px;
}

.directory-filters-trigger-main {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.directory-filters-trigger-title {
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  letter-spacing: 0.03em;
  color: rgba(245, 243, 255, 0.96);
}

.directory-filters-dirty-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: var(--radius-full, 9999px);
  background: rgba(167, 139, 250, 0.95);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.35);
}

.directory-filters-trigger-summary {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.3;
  color: var(--color-text-tertiary, #8b8b9a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.directory-filters-trigger-chevron {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  color: var(--color-text-tertiary, #8b8b9a);
  transition: transform 0.2s ease;
}

.directory-filters-trigger-chevron.is-open {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .directory-filters-trigger-chevron {
    transition: none;
  }

  .directory-filters--dropdown .directory-filters-panel {
    backdrop-filter: none;
  }
}

.directory-filters--dropdown .directory-filters-panel {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  margin-top: -1px;
  padding: 0.75rem 1rem 1rem;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0 0 var(--radius-lg, 0.75rem) var(--radius-lg);
  background: rgba(19, 18, 24, 0.98);
  backdrop-filter: blur(14px);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  max-height: min(72vh, 30rem);
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.directory-filters-desc--panel {
  margin: 0 0 var(--space-2, 0.5rem);
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.4;
  color: var(--color-text-tertiary, #8b8b9a);
}

.directory-filters-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-3, 0.75rem);
}

.directory-filters-select-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.directory-filters-select-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.directory-filters-field-label {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #a6a6b4);
}

.directory-filters-field-hint {
  margin: 0 0 0.15rem;
  font-size: var(--text-xs, 0.625rem);
  line-height: 1.35;
  color: var(--color-text-tertiary, #7e7e8c);
}

.directory-filters-micro-hint {
  margin: 0.2rem 0 0;
  font-size: 0.625rem;
  line-height: 1.35;
  color: var(--color-text-tertiary, #6e6e7c);
}

.directory-filter-multiselect {
  width: 100%;
  margin: 0;
  padding: 0.35rem 0.45rem;
  font-size: var(--text-xs, 0.8125rem);
  line-height: 1.35;
  color: var(--color-text-primary, #ececf4);
  background: rgba(12, 11, 16, 0.95);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  box-sizing: border-box;
}

.directory-filter-multiselect:focus {
  outline: 2px solid rgba(123, 77, 181, 0.55);
  outline-offset: 1px;
}

.directory-filter-multiselect option {
  padding: 0.35rem 0.45rem;
  color: #e8e8f0;
  background: #16151c;
}

.directory-filter-multiselect option:checked {
  background: rgba(91, 33, 182, 0.5);
  color: #faf5ff;
}

.directory-filters-select-field .directory-filters-text-btn {
  margin-top: 0.35rem;
  align-self: flex-start;
}

.directory-filters--dropdown .directory-sort-control {
  padding: 0.3rem 0.55rem;
  gap: 0.4rem;
  background: rgba(0, 0, 0, 0.18);
  border-color: rgba(255, 255, 255, 0.07);
}

.directory-filters--dropdown .directory-filters-clear {
  padding: 0.35rem 0.75rem;
  font-size: 0.6875rem;
}

.directory-back-top {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--nav-height, 4rem) + 0.75rem + env(safe-area-inset-bottom, 0px));
  z-index: 40;
  padding: 0.55rem 1.15rem;
  font-size: var(--text-xs, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.02em;
  color: var(--color-text-primary, #fafafa);
  background: rgba(22, 20, 30, 0.94);
  border: 1px solid rgba(167, 139, 250, 0.42);
  border-radius: var(--radius-full, 9999px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
  cursor: pointer;
}

.directory-back-top:hover {
  border-color: rgba(196, 181, 253, 0.55);
  background: rgba(32, 28, 44, 0.96);
}

.directory-back-top:focus-visible {
  outline: 2px solid rgba(123, 77, 181, 0.65);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .directory-back-top {
    backdrop-filter: none;
  }
}

.directory-sort-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.directory-sort-label {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary, #6e6e7e);
}

.directory-sort-select {
  min-width: 9.5rem;
  padding: 0.35rem 0.5rem;
  font-size: var(--text-xs, 0.8125rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.375rem);
  cursor: pointer;
}

.directory-sort-select:focus {
  outline: 2px solid rgba(123, 77, 181, 0.55);
  outline-offset: 1px;
}

.directory-sort-dir {
  padding: 0.35rem 0.65rem;
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #c4c4d4);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.375rem);
  cursor: pointer;
  white-space: nowrap;
}

.directory-sort-dir:hover {
  border-color: rgba(123, 77, 181, 0.45);
  color: var(--color-text-primary, #f4f4f8);
}

.directory-filters-clear {
  padding: 0.4rem 0.85rem;
  font-size: var(--text-xs, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-primary, #faf5ff);
  background: rgba(123, 77, 181, 0.35);
  border: 1px solid rgba(167, 139, 250, 0.45);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
}

.directory-filters-clear:hover {
  background: rgba(123, 77, 181, 0.5);
}

.directory-filters-text-btn {
  margin-top: var(--space-2, 0.5rem);
  padding: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-accent-purple-light, #c4b5fd);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.directory-filters-text-btn:hover {
  color: #e9d5ff;
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

.location-count-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-normal, 400);
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.4;
}

.directory-vcard-btn.is-open .vcard-dropdown-chevron {
  transform: rotate(180deg);
}

/* vCard export panel */
.vcard-export-wrap {
  position: relative;
}

.vcard-dropdown-chevron {
  width: 0.875rem;
  height: 0.875rem;
  margin-left: 0.35rem;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.vcard-export-panel {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 20;
  width: min(22rem, calc(100vw - 2rem));
  max-height: min(70vh, 28rem);
  overflow-y: auto;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  background: linear-gradient(
    165deg,
    rgba(24, 24, 32, 0.98) 0%,
    rgba(18, 18, 26, 0.98) 100%
  );
  backdrop-filter: blur(var(--blur-lg, 20px));
  -webkit-backdrop-filter: blur(var(--blur-lg, 20px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-lg, 0.75rem);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(123, 77, 181, 0.12) inset;
}

.vcard-export-panel-title {
  margin: 0 0 0.35rem;
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
}

.vcard-export-mono {
  font-family: ui-monospace, monospace;
  font-size: 0.8125em;
}

.vcard-export-panel-desc {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.75rem);
  line-height: 1.45;
  color: var(--color-text-tertiary, #8b8b9a);
}

.vcard-export-fieldset {
  margin: 0 0 var(--space-3, 0.75rem);
  padding: 0;
  border: none;
}

.vcard-export-legend {
  margin: 0 0 var(--space-2, 0.5rem);
  padding: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #a8a8b8);
}

.vcard-export-radios {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.vcard-export-radio {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: var(--text-xs, 0.8125rem);
  color: var(--color-text-secondary, #c8c8d8);
  cursor: pointer;
}

.vcard-export-radio-input {
  margin-top: 0.15rem;
  accent-color: var(--color-accent-purple, #7b4db5);
}

.vcard-export-muted {
  font-weight: var(--weight-normal, 400);
  color: var(--color-text-tertiary, #7a7a8a);
}

.vcard-export-smart-hint {
  margin: var(--space-2, 0.5rem) 0 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.4;
  color: var(--color-text-tertiary, #9a9aaa);
}

.vcard-export-sort-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-3, 0.75rem);
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.vcard-export-sort-label {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary, #6e6e7e);
}

.vcard-export-select {
  flex: 1 1 9rem;
  min-width: 0;
  padding: 0.35rem 0.5rem;
  font-size: var(--text-xs, 0.8125rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.375rem);
  cursor: pointer;
}

.vcard-export-sort-dir {
  padding: 0.35rem 0.55rem;
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #c4c4d4);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.375rem);
  cursor: pointer;
  white-space: nowrap;
}

.vcard-export-sort-dir:hover {
  border-color: rgba(123, 77, 181, 0.45);
  color: var(--color-text-primary, #f4f4f8);
}

.vcard-export-meta {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.75rem);
  color: var(--color-text-tertiary, #8b8b9a);
}

.vcard-export-warn {
  color: #fbbf24;
}

.vcard-export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
  justify-content: flex-end;
}

.vcard-export-download {
  padding: 0.45rem 1rem;
  font-size: var(--text-xs, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  color: #faf5ff;
  background: linear-gradient(145deg, rgba(123, 77, 181, 0.55), rgba(91, 33, 182, 0.45));
  border: 1px solid rgba(196, 181, 253, 0.45);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
}

.vcard-export-download:hover:not(:disabled) {
  filter: brightness(1.06);
}

.vcard-export-download:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.vcard-export-cancel {
  padding: 0.45rem 0.75rem;
  font-size: var(--text-xs, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #a0a0b0);
  background: transparent;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
}

.vcard-export-cancel:hover {
  background: rgba(255, 255, 255, 0.06);
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

.location-type-badge {
  display: inline-flex;
  align-items: center;
  max-width: 11rem;
  padding: 0.125rem 0.4rem;
  margin-left: 0.375rem;
  font-size: 0.5625rem;
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.03em;
  line-height: 1.2;
  border-radius: var(--radius-sm, 0.25rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.location-type-badge--hub {
  text-transform: uppercase;
  color: white;
  background: linear-gradient(135deg, var(--color-accent-purple, #7b4db5), var(--color-accent-orange, #ff6b1a));
}

.location-type-badge--muted {
  text-transform: none;
  color: var(--color-text-secondary, #a0a0b0);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
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
