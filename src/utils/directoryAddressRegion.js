/** Canadian province / territory codes (FedEx-style addresses). */
const CA_PROVINCES = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
])

/** US state & territory codes commonly used on FedEx-style lines. */
const US_REGION_CODES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
  'UM',
  'AA',
  'AE',
  'AP',
])

const CA_PROV_LABEL = Object.freeze({
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
})

const US_STATE_LABEL = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  UM: 'U.S. Minor Outlying Islands',
  AA: 'Armed Forces Americas',
  AE: 'Armed Forces Europe',
  AP: 'Armed Forces Pacific',
})

/**
 * @param {string} s
 */
function looksLikeNorthAmericanPostal(s) {
  const t = String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  if (/^\d{5}(-\d{4})?$/.test(t)) return true
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(t)) return true
  return false
}

/**
 * Infer ISO-like country code and state/province from a one-line directory address
 * shaped like `street, city, ST, postal` (FedEx CSV import / seed format).
 * @param {string} address
 * @returns {{
 *   countryCode: string,
 *   stateCode: string,
 *   composite: string,
 *   stateLabel: string,
 *   countryLabel: string,
 * }}
 */
export function inferRegionFromDirectoryAddress(address) {
  const empty = {
    countryCode: '',
    stateCode: '',
    composite: '',
    stateLabel: '',
    countryLabel: '',
  }
  const parts = String(address ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return empty

  let rest = parts.slice()
  const last = rest[rest.length - 1]
  if (looksLikeNorthAmericanPostal(last)) {
    rest = rest.slice(0, -1)
  }
  if (rest.length < 1) return empty

  const regionRaw = rest[rest.length - 1]
  const token = String(regionRaw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
  if (!/^[A-Z]{2}$/.test(token)) {
    return {
      ...empty,
      stateLabel: String(regionRaw).trim(),
    }
  }
  if (CA_PROVINCES.has(token)) {
    const countryCode = 'CA'
    return {
      countryCode,
      stateCode: token,
      composite: `${countryCode}|${token}`,
      stateLabel: CA_PROV_LABEL[token] ?? token,
      countryLabel: 'Canada',
    }
  }
  if (US_REGION_CODES.has(token)) {
    const countryCode = 'US'
    return {
      countryCode,
      stateCode: token,
      composite: `${countryCode}|${token}`,
      stateLabel: US_STATE_LABEL[token] ?? token,
      countryLabel: 'United States',
    }
  }
  return {
    ...empty,
    stateLabel: token,
  }
}

/**
 * @param {string} countryCode
 */
export function countryLabelFromCode(countryCode) {
  const c = String(countryCode ?? '').toUpperCase()
  if (c === 'US') return 'United States'
  if (c === 'CA') return 'Canada'
  return c || 'Unknown'
}
