import { getSessionUser } from '../lib/session'
import { sb } from '../supabaseClient'

async function currentUserId() {
  const { data, error } = await getSessionUser()
  if (error || !data.user) return null
  return data.user.id
}

function throwDb(error) {
  const e = new Error(error?.message || String(error))
  if (error?.code) e.code = error.code
  throw e
}

async function callRpc(name, params) {
  const { data, error } = await sb.rpc(name, params)
  if (error) throwDb(error)
  return data
}

/**
 * Ask to join a table. Server-side RPC enforces blocked check,
 * capacity check, and duplicate-request check.
 */
export async function requestJoin(tableId) {
  return callRpc('request_join', { p_table: tableId })
}

/** Host approves a join request. Server validates host ownership. */
export async function approveRequest(requestId) {
  return callRpc('approve_request', { p_request: requestId })
}

/** Host rejects a join request. */
export async function rejectRequest(requestId) {
  return callRpc('reject_request', { p_request: requestId })
}

/**
 * Confirm a free seat (rides only — no payment).
 * Paid tables must go through the payment provider + server webhook,
 * which calls confirm_paid_seat. Never call confirm_paid_seat from the client.
 */
export async function confirmFreeSeat(tableId) {
  return callRpc('confirm_free_seat', { p_table: tableId })
}

/** Join the waitlist when a table is full. */
export async function joinWaitlist(tableId) {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in to join the waitlist')

  const { data, error } = await sb
    .from('waitlist')
    .insert({ table_id: tableId, user_id: userId })
    .select()
    .single()

  if (error) throwDb(error)
  return data
}

/** Leave the waitlist for a table. */
export async function leaveWaitlist(tableId) {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in')

  const { error } = await sb
    .from('waitlist')
    .delete()
    .eq('table_id', tableId)
    .eq('user_id', userId)

  if (error) throwDb(error)
}

/**
 * Leave a table. No refund — the payments row stays as 'paid'.
 * Call only after the user confirms in the UI.
 */
export async function leaveTable(tableId) {
  return callRpc('leave_table', { p_table: tableId })
}

function personName(profile) {
  if (!profile) return 'Anonym'
  const n = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return n || 'Anonym'
}

/**
 * Incoming join requests for tables the current user hosts.
 * @param {string[]} tableIds
 */
export async function fetchIncomingRequests(tableIds) {
  if (!tableIds?.length) return []

  const { data, error } = await sb
    .from('requests')
    .select(
      `
      id,
      table_id,
      user_id,
      status,
      created_at,
      profile:profiles!requests_user_id_fkey (
        id, first_name, last_name, age, photo_path, rating
      )
    `,
    )
    .in('table_id', tableIds)
    .order('created_at', { ascending: false })

  if (error) throwDb(error)
  return data ?? []
}

/** Outgoing join requests for the signed-in user. */
export async function fetchMyOutgoingRequests(userId) {
  if (!userId) return []

  const { data, error } = await sb
    .from('requests')
    .select('id, table_id, user_id, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throwDb(error)
  return data ?? []
}

/**
 * Realtime changes on requests for one table.
 * handlers: { onInsert?, onUpdate? }
 * Returns unsubscribe.
 */
export function subscribeRequests(tableId, handlers = {}) {
  if (!tableId) return () => {}

  const channel = sb
    .channel(`requests:${tableId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'requests',
        filter: `table_id=eq.${tableId}`,
      },
      (payload) => handlers.onInsert?.(payload.new),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'requests',
        filter: `table_id=eq.${tableId}`,
      },
      (payload) => handlers.onUpdate?.(payload.new),
    )
    .subscribe()

  return () => {
    sb.removeChannel(channel)
  }
}

/** Map a DB request row to the UI card shape used in HajdeApp. */
export function mapRequestForUi(r) {
  const profile = r.profile || r.profiles || null
  return {
    rid: r.id,
    user_id: r.user_id,
    table_id: r.table_id,
    name: personName(profile),
    age: profile?.age,
    from: profile?.is_tourist ? (profile?.from_place || 'Turist') : (profile?.from_place || 'Kosovë'),
    photo: null,
    photo_path: profile?.photo_path ?? null,
    status: r.status,
  }
}
