/** Stable interest codes stored in taste_profiles.interests (not display labels). */
export const INTEREST_CODES = [
  'muzike',
  'sport',
  'libra',
  'udhetim',
  'art',
  'teknologji',
  'kulinari',
  'natyre',
]

/** Legacy Albanian labels (and a few variants) → stable codes. Read-time normalization only. */
const LEGACY_INTEREST_LABELS = {
  Muzikë: 'muzike',
  Sport: 'sport',
  Libra: 'libra',
  Udhëtime: 'udhetim',
  Art: 'art',
  'Art & dizajn': 'art',
  Teknologji: 'teknologji',
  Kulinari: 'kulinari',
  Gastronomi: 'kulinari',
  Natyrë: 'natyre',
}

/** Codes → Albanian CAT_VIBE interest labels used for match scoring. */
export const INTEREST_TO_VIBE = {
  muzike: ['Muzikë'],
  sport: ['Sport'],
  libra: ['Libra'],
  udhetim: ['Udhëtime'],
  art: ['Art & dizajn'],
  teknologji: ['Teknologji'],
  kulinari: ['Gastronomi'],
  natyre: ['Natyrë', 'Udhëtime'],
}

export function normalizeInterestCode(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (INTEREST_CODES.includes(s)) return s
  return LEGACY_INTEREST_LABELS[s] || null
}

export function normalizeInterests(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    const code = normalizeInterestCode(item)
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

/** Expand stored codes (or legacy labels) to vibe labels for table matching. */
export function interestsForMatching(rawInterests) {
  const vibes = new Set()
  for (const item of rawInterests || []) {
    const code = normalizeInterestCode(item)
    if (code && INTEREST_TO_VIBE[code]) {
      INTEREST_TO_VIBE[code].forEach((v) => vibes.add(v))
    } else if (typeof item === 'string' && !code) {
      vibes.add(item)
    }
  }
  return [...vibes]
}
