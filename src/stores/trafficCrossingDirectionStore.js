import { ref } from 'vue'

/** Traffic → Crossings toggle: filters bridge alerts when trip direction cannot be inferred. */
export const trafficCrossingDirection = ref(/** @type {'ToNY' | 'ToNJ'} */ ('ToNY'))
