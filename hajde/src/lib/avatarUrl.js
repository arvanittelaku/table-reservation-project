import { getAvatarUrl, clearAvatarCache } from '../api/storage'

/**
 * Back-compat helper used by useChat.
 * Prefer useAvatar(photoPath) in React components (profile modal, feed).
 */
export async function avatarUrl(photoPath) {
  return getAvatarUrl(photoPath)
}

export function clearAvatarUrlCache(photoPath) {
  clearAvatarCache(photoPath)
}
