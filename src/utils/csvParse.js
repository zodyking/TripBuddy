/**
 * Parse one CSV line (RFC 4180-style): commas split fields; double quotes wrap fields;
 * `""` inside quotes becomes `"`.
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const out = []
  let cur = ''
  let i = 0
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Parse CSV text into row objects (first row = headers). Handles quoted fields.
 * @param {string} csvText
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvRecords(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  const rows = []
  for (let li = 1; li < lines.length; li++) {
    const values = parseCsvLine(lines[li])
    /** @type {Record<string, string>} */
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? ''
    })
    rows.push(obj)
  }
  return rows
}
