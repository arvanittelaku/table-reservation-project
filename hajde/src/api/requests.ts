import { sb } from '../backendClient'
import { callRpc, currentUserId } from './rpc'
import { throwDb } from '../lib/errors'
import type { ProfileRow, RequestRow, RequestStatus, Uuid, WaitlistRow } from '../types/db'

type RequesterProfile = Pick<ProfileRow, 'id' | 'first_name' | 'last_name' | 'age' | 'photo_path' | 'rating'> & Partial<Pick<ProfileRow, 'is_tourist' | 'from_place'>>
/** A join request with the requester's profile (host view). */
export interface IncomingRequest extends RequestRow { profile: RequesterProfile | null; profiles?: RequesterProfile | null }

/** A join request as the table sheet shows it. */
export interface UiRequest {
  rid: Uuid
  user_id: Uuid
  table_id?: Uuid
  name: string
  age: number | null | undefined
  from: string
  isTourist?: boolean
  photo: string | null
  photo_path: string | null
  status: RequestStatus
}

/**
 * Ask to join a table. Server-side RPC enforces blocked check,
 * capacity check, and duplicate-request check.
 */
export async function requestJoin(tableId: Uuid) {
  return callRpc<unknown>('request_join', { p_table: tableId })
}

/** Host approves a join request. Server validates host ownership. */
export async function approveRequest(requestId: Uuid) {
  return callRpc<unknown>('approve_request', { p_request: requestId })
}

/** Host rejects a join request. */
export async function rejectRequest(requestId: Uuid) {
  return callRpc<unknown>('reject_request', { p_request: requestId })
}

/**
 * Confirm a free seat (rides only — no payment).
 * Paid tables must go through the payment provider + server webhook,
 * which calls confirm_paid_seat. Never call confirm_paid_seat from the client.
 */
export async function confirmFreeSeat(tableId: Uuid) {
  return callRpc<unknown>('confirm_free_seat', { p_table: tableId })
}

/** Join the waitlist when a table is full. */
export async function joinWaitlist(tableId: Uuid): Promise<WaitlistRow> {
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
export async function leaveWaitlist(tableId: Uuid): Promise<void> {
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
export async function leaveTable(tableId: Uuid) {
  return callRpc<unknown>('leave_table', { p_table: tableId })
}

function personName(profile: Partial<Pick<ProfileRow, 'first_name' | 'last_name'>> | null | undefined): string {
  if (!profile) return 'Anonym'
  const n = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return n || 'Anonym'
}

/**
 * Incoming join requests for tables the current user hosts.
 */
export async function fetchIncomingRequests(tableIds: Uuid[]): Promise<IncomingRequest[]> {
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
    .returns<IncomingRequest>()
    .in('table_id', tableIds)
    .order('created_at', { ascending: false })

  if (error) throwDb(error)
  return data ?? []
}

/** Outgoing join requests for the signed-in user. */
export async function fetchMyOutgoingRequests(userId: Uuid | null | undefined): Promise<RequestRow[]> {
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
export function subscribeRequests(tableId: Uuid | null | undefined, handlers: { onInsert?: (row: RequestRow) => void; onUpdate?: (row: RequestRow) => void } = {}): () => void {
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
      (payload) => { if (payload.new) handlers.onInsert?.(payload.new) },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'requests',
        filter: `table_id=eq.${tableId}`,
      },
      (payload) => { if (payload.new) handlers.onUpdate?.(payload.new) },
    )
    .subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}

/** Map a DB request row to the UI card shape used in HajdeApp. */
export function mapRequestForUi(r: IncomingRequest): UiRequest {
  const profile = r.profile || r.profiles || null
  return {
    rid: r.id,
    user_id: r.user_id,
    table_id: r.table_id,
    name: personName(profile),
    age: profile?.age,
    from: profile?.from_place || '',
    isTourist: !!profile?.is_tourist,
    photo: null,
    photo_path: profile?.photo_path ?? null,
    status: r.status,
  }
}
