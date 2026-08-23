import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listTables } from '../api/tables'
import { sb } from '../supabaseClient'
import { matchScore as libMatchScore } from '../lib/matchScore'

/**
 * Feed tables for a city/category.
 * Supports both:
 *   useTables({ city, category, tasteProfile, affinity })
 *   useTables(city, cat, tasteProfile, affinity)
 */
export function useTables(cityOrOpts, categoryArg, tasteArg, affinityArg) {
  const opts =
    cityOrOpts && typeof cityOrOpts === 'object' && !Array.isArray(cityOrOpts)
      ? cityOrOpts
      : {
          city: cityOrOpts,
          category: categoryArg,
          tasteProfile: tasteArg,
          affinity: affinityArg,
        }

  const {
    city,
    category,
    tasteProfile = null,
    affinity = [],
  } = opts

  const [rawTables, setRawTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchGen = useRef(0)

  const refetch = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true
    const gen = ++fetchGen.current

    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      const rows = await listTables(city, category)
      if (gen !== fetchGen.current) return
      setRawTables(rows)
      setError(null)
    } catch (err) {
      if (gen !== fetchGen.current) return
      console.error('[ejaBashkohu] Gabim gjatë ngarkimit të tavolinave:', err)
      setError(err)
      setRawTables([])
    } finally {
      if (gen === fetchGen.current) setLoading(false)
    }
  }, [city, category])

  useEffect(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    const channel = sb
      .channel(`tables-memberships:${city ?? 'all'}:${category ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships' },
        () => {
          void refetch({ silent: true })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requests' },
        () => {
          void refetch({ silent: true })
        },
      )
      .subscribe()

    return () => {
      sb.removeChannel(channel)
    }
  }, [city, category, refetch])

  const tables = useMemo(() => {
    const scored = rawTables.map((table) => ({
      ...table,
      _match: libMatchScore(tasteProfile, table, affinity),
    }))
    scored.sort((a, b) => (b._match ?? 0) - (a._match ?? 0))
    return scored
  }, [rawTables, tasteProfile, affinity])

  return {
    tables,
    loading,
    error,
    refetch,
  }
}
