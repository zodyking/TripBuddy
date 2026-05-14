/**
 * Re-export shared directory location type helpers from the server module so Vite bundles one source of truth.
 * @see server/directory-location-types.mjs
 */
export {
  DIRECTORY_STATION_TYPES,
  DIRECTORY_LOCATION_TYPE_OTHER,
  filterKeyForLocationType,
  normalizeLocationTypeForStorage,
  countByDirectoryLocationType,
  compareDirectoryTypeFilterKeys,
} from '../../server/directory-location-types.mjs'
