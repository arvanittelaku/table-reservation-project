import { interestsForMatching } from './tasteInterests'
import type { AffinityRow } from '../types/db'

/** What a category is like (who it suits). */
export interface Vibe { interests?: string[]; time?: string | null; depth?: string | null; energy?: string | null }
/** Taste answers, as stored (taste_profiles row) or as kept in the app (camelCase). */
export interface TasteInput {
  done?: boolean | null
  groupSize?: string | null
  group_size?: string | null
  depth?: string | null
  time?: string | null
  time_pref?: string | null
  energy?: string | null
  interests?: unknown
}
export interface MatchableTable { cat?: string; category?: string; vibe?: Vibe | null; tags?: string[]; spots?: number; max_spots?: number; mystery?: boolean }
export type AffinityInput = Record<string, number> | AffinityRow[] | null | undefined

/**
 * Match score for a table vs the viewer (5-factor taste quiz + affinity).
 * Returns 45–98 for feed sorting (_match).
 */
const CAT_VIBE: Record<string, Vibe> = {
  kafe: { interests: ['Gastronomi', 'Libra'], time: null, depth: null, energy: 'mes' },
  pije: { interests: ['Muzikë'], time: 'mbremje', depth: 'argetim', energy: 'ekstrovert' },
  ushqim: { interests: ['Gastronomi'], time: 'mbremje', depth: 'thella', energy: 'mes' },
  natyre: { interests: ['Udhëtime', 'Sport'], time: 'paradite', depth: 'argetim', energy: 'mes' },
  pishine: { interests: ['Sport', 'Udhëtime'], time: 'pasdite', depth: 'argetim', energy: 'ekstrovert' },
  apartament: { interests: ['Art & dizajn', 'Muzikë'], time: 'mbremje', depth: 'argetim', energy: 'introvert' },
  sport: { interests: ['Sport'], time: 'pasdite', depth: 'argetim', energy: 'ekstrovert' },
  muzike: { interests: ['Muzikë'], time: 'mbremje', depth: 'argetim', energy: 'ekstrovert' },
  lojera: { interests: ['Teknologji'], time: 'mbremje', depth: 'argetim', energy: 'mes' },
  hiking: { interests: ['Udhëtime', 'Sport'], time: 'paradite', depth: 'argetim', energy: 'mes' },
  biciklete: { interests: ['Sport', 'Udhëtime'], time: 'paradite', depth: 'argetim', energy: 'ekstrovert' },
  studim: { interests: ['Libra', 'Teknologji'], time: 'pasdite', depth: 'thella', energy: 'introvert' },
  vullnetarizem: { interests: ['Udhëtime'], time: 'paradite', depth: 'thella', energy: 'mes' },
  vozitje: { interests: ['Udhëtime'], time: null, depth: null, energy: null },
  udhetim: { interests: ['Udhëtime'], time: null, depth: 'te-dyja', energy: 'mes' },
}

function normalizeTaste(raw: TasteInput | null | undefined) {
  if (!raw) return null
  return {
    done: raw.done,
    groupSize: raw.groupSize ?? raw.group_size,
    depth: raw.depth,
    time: raw.time ?? raw.time_pref,
    energy: raw.energy,
    interests: Array.isArray(raw.interests) ? (raw.interests as unknown[]) : [],
    // normalized lazily in matchScore via interestsForMatching
  }
}

function affinityForCategory(affinityMap: AffinityInput, cat: string | undefined): number {
  if (cat === undefined) return 0
  if (affinityMap && typeof affinityMap === 'object' && !Array.isArray(affinityMap)) {
    return Number(affinityMap[cat] ?? 0) || 0
  }
  if (Array.isArray(affinityMap)) {
    const row = affinityMap.find((r) => r.category === cat)
    return Number(row?.score ?? 0) || 0
  }
  return 0
}

export function matchScore(myTaste: TasteInput | null | undefined, table: MatchableTable | null | undefined, affinityMap: AffinityInput = {}): number | null {
  const p = normalizeTaste(myTaste)
  if (!p?.done) return null

  let s = 45
  const cat = table?.cat ?? table?.category
  const vibe: Vibe = table?.vibe || (cat ? CAT_VIBE[cat] : undefined) || {}
  const profileVibes = interestsForMatching(p.interests)
  const tableInterests = Array.isArray(vibe.interests) ? vibe.interests : []
  const tags = Array.isArray(table?.tags) ? table.tags : []
  const comparePool = tableInterests.length ? tableInterests : tags

  const shared = comparePool.filter((i) => profileVibes.includes(i))
  s += Math.min(5, shared.length) * 12

  if (vibe.depth && (vibe.depth === p.depth || p.depth === 'te-dyja')) s += 15
  if (vibe.time && vibe.time === p.time) s += 12

  const spots = Number(table?.spots ?? table?.max_spots ?? 4)
  const gs = spots <= 4 ? 'vogla' : spots <= 6 ? 'mesatare' : 'medha'
  if (gs === p.groupSize) s += 12

  if (vibe.energy && vibe.energy === p.energy) s += 10

  s += Math.max(-15, Math.min(15, affinityForCategory(affinityMap, cat)))

  if (table?.mystery) s = Math.max(s, 93)

  return Math.max(45, Math.min(98, Math.round(s)))
}
