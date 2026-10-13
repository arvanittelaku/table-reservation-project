import { sb } from '../backendClient'
import { currentUserId } from './rpc'
import { throwDb } from '../lib/errors'
import { formatEventTime, isTableExpired } from '../lib/formatEventTime'
import type { Vibe } from '../lib/matchScore'
import type { MembershipRole, ProfileRow, RequestRow, RequestStatus, SkillLevel, Sport, TableKind, TableRow, TableStatus, TasteProfileRow, Uuid } from '../types/db'
import type { UiRequest } from './requests'

type HostProfile = Pick<ProfileRow, 'id' | 'first_name' | 'last_name' | 'age' | 'photo_path' | 'verified' | 'rating' | 'tables_hosted'>
type MemberProfile = Pick<ProfileRow, 'id' | 'first_name' | 'last_name' | 'age' | 'photo_path'> & Partial<Pick<ProfileRow, 'verified' | 'rating'>>
type JoinedRequest = Pick<RequestRow, 'id' | 'user_id' | 'status'> & Partial<Pick<RequestRow, 'created_at'>> & { profile?: MemberProfile | null }

/** A tables row with the joins the feed selects (host, seats, requests, waitlist). */
export interface TableWithJoins extends TableRow {
  host?: HostProfile | null
  memberships?: Array<{ user_id: Uuid; role: MembershipRole; joined_at?: string; profile?: MemberProfile | null }>
  requests?: JoinedRequest[]
  waitlist?: Array<{ user_id: Uuid }>
  /** official_events row (one or none): events hosted by the ejaBashkohu team */
  official_events?: Array<{ premium_hours: number }>
  my_request?: JoinedRequest | null
  my_request_status?: RequestStatus | null
}

/** A seated person (host first). */
export interface UiMember { user_id: Uuid; name: string; photo_path: string | null; age: number | null }

/** A table in the shape the app's screens use (cafe, host, joined[], requests[], time, cat, …). */
export interface UiTable {
  id: Uuid
  shareCode: string | null
  host_id: Uuid
  kind: TableKind
  cat: string
  sport: Sport | null
  skillLevel: SkillLevel | null
  cafe: string
  area: string
  city: string
  to_city: string | null
  budget: string | undefined
  mapsLink: string
  host: string
  hostAge: number | null
  hostFrom: string
  hostVerified: boolean
  hostRating: number
  hostTables: number
  hostPhotoPath: string | null
  time: string
  event_datetime: string | null
  isExpired: boolean
  time_label: string
  spots: number
  joined: string[]
  joinedIds: Uuid[]
  members: UiMember[]
  requests: UiRequest[]
  waitlist: Uuid[]
  waitlistIds: Uuid[]
  langs: string[]
  tags: string[]
  desc: string
  chat: never[]
  womenOnly: boolean
  menOnly: boolean
  mystery: boolean
  revealed: boolean
  vibe: Vibe | null
  my_request: JoinedRequest | null
  my_request_status: RequestStatus | null
  seats_taken: number
  status: TableStatus
  /** Official event hosted by the team: until `premiumUntil` only Premium members can join. */
  official: OfficialInfo | null
  /** Match score (45–98) once a taste profile exists. */
  _match?: number | null
}

export interface OfficialInfo { premiumHours: number; premiumUntil: string | null }

/** Official event whose Premium-only window is still running (else null). */
export function officialPremiumWindowUntil(t: Pick<UiTable, 'official'>, now = Date.now()): Date | null {
  const until = t.official?.premiumUntil ? new Date(t.official.premiumUntil) : null
  return until && until.getTime() > now ? until : null
}

function officialInfo(row: TableWithJoins): OfficialInfo | null {
  const o = Array.isArray(row.official_events) ? row.official_events[0] : undefined
  if (!o) return null
  const ev = row.event_datetime ? new Date(row.event_datetime).getTime() : NaN
  return {
    premiumHours: o.premium_hours,
    premiumUntil: Number.isFinite(ev) ? new Date(ev - o.premium_hours * 3600_000).toISOString() : null,
  }
}

/** A table loaded on its own (share link, just created) with extra detail. */
export interface UiTableDetail extends UiTable {
  waitlist_count: number
  pending_requests: JoinedRequest[]
  raw: TableWithJoins
}

/** Columns the app writes when opening a table. */
export type NewTable = Partial<Omit<TableRow, 'id' | 'host_id' | 'created_at' | 'share_code' | 'activity_at' | 'status'>> & Pick<TableRow, 'kind' | 'category' | 'title' | 'city' | 'time_label' | 'event_datetime' | 'spots'>

const HOST_SELECT = `
  id,
  first_name,
  last_name,
  age,
  photo_path,
  verified,
  rating,
  tables_hosted
`

function personName(profile: Partial<Pick<ProfileRow, 'first_name' | 'last_name'>> | null | undefined, fallback?: string): string {
  if (!profile) return fallback || 'User'
  const n = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return n || fallback || 'User'
}

/**
 * Map a Supabase tables row into the flat shape HajdeApp UI expects
 * (cafe, host, joined[], requests[], time, cat, …).
 */
export function toUiTable(row: TableWithJoins): UiTable {
  const h: Partial<HostProfile> = row.host || {}
  const hostName = personName(h, 'Host')
  const memberships = Array.isArray(row.memberships) ? row.memberships : []
  const requests = Array.isArray(row.requests) ? row.requests : []
  const waitlist = Array.isArray(row.waitlist) ? row.waitlist : []

  const joined = memberships.map((m) => personName(m.profile, m.user_id))
  const joinedIds = memberships.map((m) => m.user_id)
  const members = memberships.map((m) => ({
    user_id: m.user_id,
    name: personName(m.profile, m.user_id),
    photo_path: m.profile?.photo_path ?? null,
    age: m.profile?.age ?? null,
  }))

  // Ensure host appears in joined for seat ring
  if (row.host_id && !joinedIds.includes(row.host_id)) {
    joined.unshift(hostName)
    joinedIds.unshift(row.host_id)
    members.unshift({
      user_id: row.host_id,
      name: hostName,
      photo_path: h.photo_path || null,
      age: h.age ?? null,
    })
  }

  return {
    id: row.id,
    shareCode: row.share_code || null,
    host_id: row.host_id,
    kind: row.kind,
    cat: row.category,
    sport: row.sport || null,
    skillLevel: row.skill_level || null,
    cafe: row.title,
    area: row.area || '',
    city: row.city,
    to_city: row.to_city,
    budget: row.budget || undefined,
    mapsLink: row.maps_link || '',
    host: hostName,
    hostAge: h.age ?? null,
    hostFrom: '',
    hostVerified: !!h.verified,
    hostRating: Number(h.rating) || 5,
    hostTables: h.tables_hosted || 0,
    hostPhotoPath: h.photo_path || null,
    time: row.event_datetime ? formatEventTime(row.event_datetime) : row.time_label,
    event_datetime: row.event_datetime || null,
    isExpired: isTableExpired(row.event_datetime),
    time_label: row.time_label,
    spots: row.spots,
    joined,
    joinedIds,
    members,
    requests: requests.map((r): UiRequest => ({
      rid: r.id,
      user_id: r.user_id,
      name: personName(r.profile),
      age: r.profile?.age,
      from: '',
      photo: null,
      photo_path: r.profile?.photo_path ?? null,
      status: r.status,
    })),
    waitlist: waitlist.map((w) => w.user_id),
    waitlistIds: waitlist.map((w) => w.user_id),
    langs: row.langs?.length ? row.langs : ['Shqip'],
    tags: row.tags || [],
    desc: row.description || '',
    chat: [],
    womenOnly: !!row.women_only,
    menOnly: !!row.men_only,
    mystery: !!row.mystery,
    revealed: row.revealed !== false,
    vibe: null,
    my_request: row.my_request ?? null,
    my_request_status: row.my_request_status ?? null,
    seats_taken: joinedIds.length,
    status: row.status,
    official: officialInfo(row),
  }
}

/**
 * List open tables for a city/category.
 * Returns UI-shaped rows. RLS hides blocked hosts.
 */
export async function listTables(city: string | null | undefined, category: string | null | undefined): Promise<UiTable[]> {
  const userId = await currentUserId()

  let query = sb
    .from('tables')
    .select(
      `
      *,
      host:profiles!tables_host_id_fkey (${HOST_SELECT}),
      memberships (
        user_id,
        role,
        profile:profiles!memberships_user_id_fkey ( id, first_name, last_name, age, photo_path )
      ),
      requests (
        id,
        user_id,
        status,
        profile:profiles!requests_user_id_fkey ( id, first_name, last_name, age, photo_path )
      ),
      waitlist ( user_id ),
      official_events ( premium_hours )
    `,
    )
    .returns<TableWithJoins>()
    .eq('status', 'open')
    .order('event_datetime', { ascending: true })

  if (city) query = query.eq('city', city)
  if (category && category !== 'all') query = query.eq('category', category)

  const { data, error } = await query
  if (error) throwDb(error)

  return (data ?? []).map((row) => {
    const myRequest = userId
      ? (row.requests ?? []).find((r) => r.user_id === userId) ?? null
      : null
    return toUiTable({
      ...row,
      my_request: myRequest,
      my_request_status: myRequest?.status ?? null,
    })
  })
}

/**
 * Past tables where I had a seat (the live feed only holds upcoming open ones),
 * so "My tables" can still offer rating, connections and the chat afterwards.
 */
export async function listMyPastTables(): Promise<UiTable[]> {
  const userId = await currentUserId()
  if (!userId) return []
  const { data: mine, error: e1 } = await sb.from('memberships').select('table_id').eq('user_id', userId)
  if (e1) throwDb(e1)
  const ids = (mine ?? []).map((m) => m.table_id)
  if (ids.length === 0) return []
  const { data, error } = await sb
    .from('tables')
    .select(`
      *,
      host:profiles!tables_host_id_fkey (${HOST_SELECT}),
      memberships ( user_id, role, profile:profiles!memberships_user_id_fkey ( id, first_name, last_name, age, photo_path ) )
    `)
    .returns<TableWithJoins>()
    .in('id', ids)
    .lt('event_datetime', new Date().toISOString())
    .order('event_datetime', { ascending: false })
    .limit(30)
  if (error) throwDb(error)
  return (data ?? []).map((row) => toUiTable({ ...row, requests: [], waitlist: [] }))
}

export async function createTable(formData: NewTable): Promise<UiTable> {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in to open a table')

  const { data, error } = await sb
    .from('tables')
    .insert({ ...formData, host_id: userId })
    .select(
      `
      *,
      host:profiles!tables_host_id_fkey (${HOST_SELECT}),
      memberships (
        user_id,
        role,
        profile:profiles!memberships_user_id_fkey ( id, first_name, last_name, age, photo_path )
      ),
      requests ( id, user_id, status ),
      waitlist ( user_id )
    `,
    )
    .returns<TableWithJoins>()
    .single()

  if (error) {
    console.error('[ejaBashkohu] Table creation failed:', error)
    throwDb(error)
  }
  return toUiTable(data)
}

export async function getTable(id: Uuid): Promise<UiTableDetail | null> {
  const { data, error } = await sb
    .from('tables')
    .select(
      `
      *,
      host:profiles!tables_host_id_fkey (${HOST_SELECT}),
      memberships (
        user_id,
        role,
        joined_at,
        profile:profiles!memberships_user_id_fkey (
          id, first_name, last_name, age, photo_path, verified, rating
        )
      ),
      requests (
        id,
        user_id,
        status,
        created_at,
        profile:profiles!requests_user_id_fkey (
          id, first_name, last_name, age, photo_path, verified, rating
        )
      ),
      waitlist ( user_id ),
      official_events ( premium_hours )
    `,
    )
    .returns<TableWithJoins>()
    .eq('id', id)
    .maybeSingle()

  if (error) throwDb(error)
  if (!data) return null

  const userId = await currentUserId()
  const myRequest = userId ? (data.requests ?? []).find((r) => r.user_id === userId) ?? null : null
  const ui = toUiTable({ ...data, my_request: myRequest, my_request_status: myRequest?.status ?? null })
  return {
    ...ui,
    waitlist_count: ui.waitlistIds.length,
    pending_requests: (data.requests ?? []).filter((r) => r.status === 'pending'),
    raw: data,
  }
}

export async function updateTable(id: Uuid, fields: Partial<TableRow>): Promise<TableRow> {
  const { data, error } = await sb
    .from('tables')
    .update(fields)
    .eq('id', id)
    .select()
    .single()

  if (error) throwDb(error)
  return data
}

/**
 * Upsert the signed-in user's taste quiz answers.
 * Accepts snake_case column names (group_size, time_pref, …).
 * Note: langs live on profiles, not taste_profiles — omit them here.
 */
export async function saveTasteProfile(answers: Partial<Pick<TasteProfileRow, 'group_size' | 'depth' | 'time_pref' | 'energy'>> & { interests?: string[] } = {}): Promise<TasteProfileRow | null> {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in to save your taste profile')

  const row = {
    user_id: userId,
    group_size: answers.group_size ?? null,
    depth: answers.depth ?? null,
    time_pref: answers.time_pref ?? null,
    energy: answers.energy ?? null,
    interests: Array.isArray(answers.interests) ? answers.interests : [],
    done: true,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await sb
    .from('taste_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .maybeSingle()

  if (error) throwDb(error)
  return data
}
