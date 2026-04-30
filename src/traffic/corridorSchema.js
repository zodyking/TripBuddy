/**
 * Schematic “subway map” for NYC / NJ truck corridors + WGS84 sample points for TomTom Flow Segment Data.
 * Coordinates are approximate; schematic positions are for layout only.
 */

/** @typedef {{ id: string, label?: string, x: number, y: number, role?: 'hub' | 'airport' | 'bridge' }} CorridorNode */
/** @typedef {{ id: string, label: string, color: string, path: [number, number][], samples: [number, number][] }} CorridorEdge */

export const CORRIDOR_VIEWBOX = '0 0 920 540'

/** @type {CorridorNode[]} */
export const corridorNodes = [
  { id: 'philadelphia', label: 'Philadelphia', x: 40, y: 480, role: 'hub' },
  { id: 'new_brunswick', label: 'New Brunswick', x: 110, y: 380, role: 'hub' },
  { id: 'newark', label: 'Newark', x: 175, y: 315, role: 'hub' },
  { id: 'jersey_city', label: 'Jersey City', x: 260, y: 268, role: 'hub' },
  { id: 'secaucus', label: 'Secaucus', x: 235, y: 248 },
  { id: 'north_bergen', label: 'N. Bergen', x: 275, y: 228 },
  { id: 'fort_lee', label: 'Fort Lee', x: 318, y: 205 },
  { id: 'manhattan_w', label: 'Manhattan', x: 345, y: 218, role: 'hub' },
  { id: 'cross_bronx_e', label: 'Bronx', x: 455, y: 118, role: 'hub' },
  { id: 'rfk', label: 'RFK', x: 488, y: 175, role: 'hub' },
  { id: 'queens_center', label: 'Queens', x: 545, y: 218, role: 'hub' },
  { id: 'jfk', label: 'JFK', x: 605, y: 292, role: 'airport' },
  { id: 'brooklyn_s', label: 'Brooklyn S', x: 455, y: 348, role: 'hub' },
  { id: 'brooklyn_c', label: 'Brooklyn', x: 415, y: 298, role: 'hub' },
  { id: 'staten', label: 'Staten Is.', x: 265, y: 438, role: 'hub' },
  { id: 'verrazano_w', label: 'Verrazzano', x: 378, y: 395, role: 'bridge' },
]

/**
 * Polylines in schematic space; samples are [lat, lng] along each corridor for TomTom.
 * @type {CorridorEdge[]}
 */
export const corridorEdges = [
  {
    id: 'nj_turnpike',
    label: 'NJ Turnpike',
    color: '#c084fc',
    path: [
      [40, 480],
      [95, 410],
      [155, 335],
      [195, 305],
    ],
    samples: [
      [39.9526, -75.1652],
      [40.4867, -74.4445],
      [40.6526, -74.1723],
      [40.6951, -74.095],
    ],
  },
  {
    id: 'us_1_9',
    label: 'US 1 & 9',
    color: '#facc15',
    path: [
      [175, 315],
      [230, 285],
      [268, 262],
    ],
    samples: [
      [40.7357, -74.1724],
      [40.7282, -74.0776],
      [40.7178, -74.0434],
    ],
  },
  {
    id: 'cross_bronx',
    label: 'Cross Bronx',
    color: '#4ade80',
    path: [
      [318, 205],
      [370, 155],
      [455, 118],
    ],
    samples: [
      [40.8517, -73.9129],
      [40.8448, -73.8844],
      [40.8373, -73.878],
    ],
  },
  {
    id: 'bqe',
    label: 'BQE / I-278',
    color: '#fb923c',
    path: [
      [488, 175],
      [455, 218],
      [430, 268],
      [415, 298],
      [395, 348],
      [378, 395],
    ],
    samples: [
      [40.8017, -73.9234],
      [40.7268, -73.9614],
      [40.7025, -73.9878],
      [40.6777, -73.9948],
      [40.6415, -74.0196],
      [40.6076, -74.0377],
    ],
  },
  {
    id: 'lie',
    label: 'LIE / I-495',
    color: '#60a5fa',
    path: [
      [455, 118],
      [520, 175],
      [580, 205],
      [630, 248],
    ],
    samples: [
      [40.8176, -73.8296],
      [40.7427, -73.7869],
      [40.7231, -73.7178],
      [40.7319, -73.6598],
    ],
  },
  {
    id: 'van_wyck_si',
    label: 'Van Wyck / SI Expwy',
    color: '#2dd4bf',
    path: [
      [605, 292],
      [565, 258],
      [545, 218],
      [380, 438],
      [265, 438],
    ],
    samples: [
      [40.6613, -73.7889],
      [40.7026, -73.8157],
      [40.7456, -73.895],
      [40.5795, -74.1498],
      [40.6046, -74.1785],
    ],
  },
  {
    id: 'brooklyn_arterials',
    label: 'Conduit · Atlantic · Caton · Church',
    color: '#f472b6',
    path: [
      [455, 348],
      [520, 355],
      [560, 368],
      [590, 382],
    ],
    samples: [
      [40.6756, -73.8568],
      [40.6786, -73.9038],
      [40.6528, -73.9595],
      [40.6412, -73.9497],
    ],
  },
  {
    id: 'lincoln_holland',
    label: 'Lincoln · Holland',
    color: '#94a3b8',
    path: [
      [318, 205],
      [335, 218],
    ],
    samples: [
      [40.7615, -73.9977],
      [40.7268, -74.0119],
    ],
  },
  {
    id: 'outerbridge_goethals',
    label: 'Outerbridge · Goethals',
    color: '#a78bfa',
    path: [
      [265, 438],
      [330, 398],
      [395, 368],
    ],
    samples: [
      [40.5248, -74.2346],
      [40.6315, -74.1955],
      [40.6426, -74.1548],
    ],
  },
  {
    id: 'bayonne_bridge',
    label: 'Bayonne Br.',
    color: '#818cf8',
    path: [
      [315, 398],
      [355, 358],
    ],
    samples: [
      [40.6426, -74.1448],
      [40.6581, -74.0875],
    ],
  },
  {
    id: 'gwb',
    label: 'George Washington Br.',
    color: '#ddd6fe',
    path: [
      [318, 205],
      [332, 212],
    ],
    samples: [
      [40.8514, -73.9527],
      [40.8489, -73.9356],
    ],
  },
]

/** Heavy traffic: current speed ≤ this fraction of free-flow */
export const HEAVY_SPEED_RATIO = 0.55

/** Minimum free-flow speed (mph) to avoid noise on very slow base roads */
export const MIN_FREE_FLOW_MPH = 18
