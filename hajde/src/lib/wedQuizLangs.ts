import { normalizeLangCode } from './langCodes'

/** Map Wednesday Dinner Q5 selection (codes or labels) to table langs array. */
export function buildWedQuizTableLangs(selected: string | string[] | null | undefined): string[] {
  const items = Array.isArray(selected) ? selected : [selected]
  const codes = [...new Set(
    items
      .map((x) => normalizeLangCode(x) || (typeof x === 'string' ? x.trim() : null))
      .filter((x): x is string => !!x),
  )]
  return codes.length ? codes : ['sq']
}
