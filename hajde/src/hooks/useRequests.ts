import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  approveRequest as apiApprove,
  fetchIncomingRequests,
  fetchMyOutgoingRequests,
  mapRequestForUi,
  rejectRequest as apiReject,
  subscribeRequests,
  type IncomingRequest,
  type UiRequest,
} from '../api/requests'
import type { RequestRow } from '../types/db'
import { getAvatarUrl } from '../api/storage'

/**
 * Attach a signed avatar URL to a UI-mapped request row.
 */
async function withPhoto(uiRow: UiRequest): Promise<UiRequest> {
  if (!uiRow.photo_path) return { ...uiRow, photo: null }
  try {
    const photo = await getAvatarUrl(uiRow.photo_path)
    return { ...uiRow, photo: photo || null }
  } catch {
    return { ...uiRow, photo: null }
  }
}

async function enrichRequests(rows: IncomingRequest[] | null | undefined): Promise<UiRequest[]> {
  return Promise.all((rows || []).map((r) => withPhoto(mapRequestForUi(r))))
}

/**
 * Requests for an active table + the signed-in user.
 *
 * Usage (HajdeApp):
 *   useRequests(activeTable?.id, user?.id)
 *
 * Also accepts legacy object form:
 *   useRequests({ userId, hostTableIds })
 */
export function useRequests(
  tableIdOrOpts: string | null | undefined | { userId?: string | null; hostTableIds?: string[] },
  maybeUserId?: string | null,
) {
  const opts = tableIdOrOpts != null && typeof tableIdOrOpts === 'object' ? tableIdOrOpts : null

  const tableId = opts ? null : (tableIdOrOpts as string | null | undefined) ?? null
  const userId = opts ? opts.userId ?? null : maybeUserId ?? null
  const hostTableIdsKey = opts ? (opts.hostTableIds || []).join(',') : tableId || ''

  const hostTableIds = useMemo((): string[] => {
    if (opts) return opts.hostTableIds || []
    return tableId ? [tableId] : []
  }, [!!opts, tableId, hostTableIdsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [incoming, setIncoming] = useState<IncomingRequest[]>([])
  const [outgoing, setOutgoing] = useState<RequestRow[]>([])
  const [pendingRequests, setPendingRequests] = useState<UiRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const refetch = useCallback(async () => {
    if (!userId) {
      setIncoming([])
      setOutgoing([])
      setPendingRequests([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [inc, out] = await Promise.all([
        hostTableIds.length ? fetchIncomingRequests(hostTableIds) : Promise.resolve([]),
        fetchMyOutgoingRequests(userId),
      ])
      setIncoming(inc || [])
      setOutgoing(out || [])

      if (tableId) {
        const pending = (inc || []).filter(
          (r) => r.table_id === tableId && r.status === 'pending',
        )
        setPendingRequests(await enrichRequests(pending))
      } else {
        setPendingRequests([])
      }
    } catch (e) {
      setError(e)
      setIncoming([])
      setOutgoing([])
      setPendingRequests([])
    } finally {
      setLoading(false)
    }
  }, [userId, hostTableIds, tableId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // Realtime: active when a hosted/open table id is present
  useEffect(() => {
    if (!userId || hostTableIds.length === 0) return undefined

    const unsubs = hostTableIds.map((tid) =>
      subscribeRequests(tid, {
        onInsert: () => {
          void refetch()
        },
        onUpdate: () => {
          void refetch()
        },
      }),
    )

    return () => {
      unsubs.forEach((u) => u?.())
    }
  }, [userId, hostTableIds, refetch])

  const myStatus = useMemo(() => {
    if (!tableId || !userId) return null
    const mine = (outgoing || []).find((r) => r.table_id === tableId)
    return mine?.status ?? null
  }, [outgoing, tableId, userId])

  const approveRequest = useCallback(
    async (requestIdOrTableId: string, maybeRequestId?: string) => {
      const requestId = maybeRequestId ?? requestIdOrTableId
      await apiApprove(requestId)
      await refetch()
    },
    [refetch],
  )

  const rejectRequest = useCallback(
    async (requestIdOrTableId: string, maybeRequestId?: string) => {
      const requestId = maybeRequestId ?? requestIdOrTableId
      await apiReject(requestId)
      await refetch()
    },
    [refetch],
  )

  return {
    incoming,
    outgoing,
    pendingRequests,
    myStatus,
    loading,
    error,
    refetch,
    approveRequest,
    rejectRequest,
  }
}
