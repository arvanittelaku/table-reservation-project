import { invalidateOwnProfile } from '../lib/ownProfile'
import { getSessionUser } from '../lib/session'
import { sb } from '../backendClient'

const BUCKET = 'avatars'
const EXPIRES_IN = 3600 // 1 hour. Never use permanent public URLs
const AVATAR_FILENAME = 'avatar.jpg'

/** Module cache: path → { url, expiresAt } */
const urlCache = new Map()

async function currentUserId() {
  const { data, error } = await getSessionUser()
  if (error || !data.user) return null
  return data.user.id
}

export function avatarStoragePath(userId) {
  return `${userId}/${AVATAR_FILENAME}`
}

/**
 * Upload to avatars/{userId}/avatar.jpg (private bucket).
 * upsert: true replaces any previous photo at the same path.
 * @returns {Promise<string>} storage path (photo_path)
 */
export async function uploadAvatar(file, expectedUserId = null) {
  const { data: { user } } = await getSessionUser()
  if (!user) throw new Error('Not signed in')
  if (expectedUserId && user.id !== expectedUserId) {
    throw new Error('Session mismatch. Restart registration')
  }
  if (!file) throw new Error('No file provided')

  const path = user.id + '/' + AVATAR_FILENAME

  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '3600',
    })

  if (error) throw new Error('Photo upload failed: ' + error.message)

  // Force a fresh signed URL after replace
  urlCache.delete(path)
  persistCache()
  return path
}

/**
 * After a successful upload: set profiles.photo_path and photo_face_ok = true.
 */
export async function saveAvatarToProfile(path, expectedUserId = null) {
  const { data: { user } } = await getSessionUser()
  if (!user) throw new Error('Not signed in')
  if (expectedUserId && user.id !== expectedUserId) {
    throw new Error('Session mismatch. Restart registration')
  }

  const { error } = await sb
    .from('profiles')
    .update({ photo_path: path, photo_face_ok: true })
    .eq('id', user.id)

  if (error) throw new Error('Photo save failed: ' + error.message)
  invalidateOwnProfile()
}

/* Signed URLs are cached in memory and in localStorage (they stay valid for
 * an hour), so reopening the app does not re-request every photo. Lookups made
 * in the same moment (a feed rendering 30 avatars) are merged into ONE
 * createSignedUrls request instead of one request per photo. */
const LS_KEY = 'ejb-avatar-urls'
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  const now = Date.now()
  for (const [p, v] of Object.entries(saved)) if (v?.expiresAt > now + 60_000) urlCache.set(p, v)
} catch { /* storage unavailable */ }
let persistTimer = null
function persistCache() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      const now = Date.now()
      const obj = {}
      for (const [p, v] of urlCache) if (v.expiresAt > now) obj[p] = v
      localStorage.setItem(LS_KEY, JSON.stringify(obj))
    } catch { /* ignore */ }
  }, 500)
}

const inflight = new Map() // path -> Promise<string|null>
let queue = new Map()      // path -> resolve
let flushTimer = null

async function flushQueue() {
  flushTimer = null
  const batch = queue
  queue = new Map()
  const paths = [...batch.keys()]
  let results = []
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, EXPIRES_IN)
    if (!error && Array.isArray(data)) results = data
  } catch { /* resolve null below */ }
  const expiresAt = Date.now() + EXPIRES_IN * 1000
  const byPath = new Map(results.map((r) => [r.path, r.signedUrl]))
  for (const [p, resolve] of batch) {
    const url = byPath.get(p) || null
    if (url) urlCache.set(p, { url, expiresAt })
    inflight.delete(p)
    resolve(url)
  }
  persistCache()
}

/**
 * Signed URL for a private avatar path (3600s). Never returns a public URL.
 */
export function getAvatarUrl(path) {
  if (!path) return Promise.resolve(null)
  const cached = urlCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 60_000) return Promise.resolve(cached.url)
  if (inflight.has(path)) return inflight.get(path)
  const promise = new Promise((resolve) => {
    queue.set(path, resolve)
    if (!flushTimer) flushTimer = setTimeout(flushQueue, 16)
  })
  inflight.set(path, promise)
  return promise
}

/**
 * Remove the current user's avatar file and clear profile fields.
 */
export async function deleteAvatar() {
  const { data: { user } } = await getSessionUser()
  if (!user) return

  const path = user.id + '/' + AVATAR_FILENAME
  await sb.storage.from(BUCKET).remove([path])
  await sb
    .from('profiles')
    .update({ photo_path: null, photo_face_ok: false })
    .eq('id', user.id)

  urlCache.delete(path)
}

/** Invalidate cached signed URL(s). */
export function clearAvatarCache(path) {
  if (path) urlCache.delete(path)
  else urlCache.clear()
  persistCache()
}
