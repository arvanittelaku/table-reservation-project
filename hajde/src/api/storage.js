import { sb } from '../supabaseClient'

const BUCKET = 'avatars'
const EXPIRES_IN = 3600 // 1 hour. Never use permanent public URLs
const AVATAR_FILENAME = 'avatar.jpg'

/** Module cache: path → { url, expiresAt } */
const urlCache = new Map()

async function currentUserId() {
  const { data, error } = await sb.auth.getUser()
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
  const { data: { user } } = await sb.auth.getUser()
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
  return path
}

/**
 * After a successful upload: set profiles.photo_path and photo_face_ok = true.
 */
export async function saveAvatarToProfile(path, expectedUserId = null) {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not signed in')
  if (expectedUserId && user.id !== expectedUserId) {
    throw new Error('Session mismatch. Restart registration')
  }

  const { error } = await sb
    .from('profiles')
    .update({ photo_path: path, photo_face_ok: true })
    .eq('id', user.id)

  if (error) throw new Error('Photo save failed: ' + error.message)
}

/**
 * Signed URL for a private avatar path (3600s). Never returns a public URL.
 */
export async function getAvatarUrl(path) {
  if (!path) return null
  const cached = urlCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.url
  }

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, EXPIRES_IN)

  if (error || !data?.signedUrl) return null

  urlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + EXPIRES_IN * 1000,
  })
  return data.signedUrl
}

/**
 * Remove the current user's avatar file and clear profile fields.
 */
export async function deleteAvatar() {
  const { data: { user } } = await sb.auth.getUser()
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
}
