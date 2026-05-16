/**
 * Common reasons when a trip is marked rejected or removed (History UI shortcut list).
 * Users may edit the text field after picking one, or type a fully custom reason.
 */
export const TRIP_OUTCOME_REASON_PRESETS = Object.freeze([
  'Removed by FedEx dispatch',
  'Rejected because of tandem ban',
  'Rejected — equipment not available',
  'Rejected — hours / availability',
  'Removed — duplicate dispatch',
  'Removed — trip cancelled by customer',
  'Other / see notes',
])
