import { normalizeLangCode } from './langCodes.js'

/** Map Wednesday Dinner Q5 selection (codes or labels) to table langs array. */
export function buildWedQuizTableLangs(selected) {
  const items = Array.isArray(selected) ? selected : [selected]
  const codes = [...new Set(
    items
      .map((x) => normalizeLangCode(x) || (typeof x === 'string' ? x.trim() : null))
      .filter(Boolean),
  )]
  return codes.length ? codes : ['sq']
}
