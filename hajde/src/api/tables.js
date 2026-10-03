import { sb } from '../supabaseClient'
import { formatEventTime, isTableExpired } from '../lib/formatEventTime'

async function currentUserId() {
  const { data, error } = await sb.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function throwDb(error) {
  const e = new Error(error?.message || String(error))
  if (error?.code) e.code = error.code
  throw e
}

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

function personName(profile, fallback) {
  if (!profile) return fallback || 'User'
  const n = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return n || fallback || 'User'
}

/**
 * Map a Supabase tables row into the flat shape HajdeApp UI expects
 * (cafe, host, joined[], requests[], time, cat, …).
 */
export function toUiTable(row) {
  const h = row.host || {}
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
    requests: requests.map((r) => ({
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
  }
}

/**
 * List open tables for a city/category.
 * Returns UI-shaped rows. RLS hides blocked hosts.
 */
export async function listTables(city, category) {
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
      waitlist ( user_id )
    `,
    )
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

export async function createTable(formData) {
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
    .single()

  if (error) {
    console.error('[ejaBashkohu] Table creation failed:', error)
    throwDb(error)
  }
  return toUiTable(data)
}

export async function getTable(id) {
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
      waitlist ( user_id )
    `,
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throwDb(error)
  if (!data) return null

  const ui = toUiTable(data)
  return {
    ...ui,
    waitlist_count: ui.waitlistIds.length,
    pending_requests: (data.requests ?? []).filter((r) => r.status === 'pending'),
    raw: data,
  }
}

export async function updateTable(id, fields) {
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
export async function saveTasteProfile(answers = {}) {
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
