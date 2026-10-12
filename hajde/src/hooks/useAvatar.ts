import { useCallback, useEffect, useState } from 'react'
import {
  clearAvatarCache,
  getAvatarUrl,
  saveAvatarToProfile,
  uploadAvatar,
} from '../api/storage'
import { flipImageFile } from '../lib/flipImage'
import { validateFacePhoto } from '../lib/faceValidation'
import type { CodedError } from '../lib/errors'

/**
 * Resolve + cache a signed avatar URL so the same photo_path is not
 * re-fetched on every render. Also handles onboarding upload (validate →
 * optional flip → Storage → profile update) with an uploading spinner flag.
 */
export function useAvatar(photoPath: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!photoPath)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false

    if (!photoPath) {
      setUrl(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    getAvatarUrl(photoPath)
      .then((signed) => {
        if (!cancelled) setUrl(signed)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setUrl(null)
          setError(err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [photoPath])

  /**
   * Onboarding photo step:
   * 1) client face validation
   * 2) optional horizontal flip ("Ktheje anën")
   * 3) uploadAvatar (upsert)
   * 4) profile.photo_path + photo_face_ok = true
   *
   * `uploading` is true while steps 3–4 run (show a spinner).
   */
  const uploadValidatedAvatar = useCallback(async (file: Blob, { flip = false }: { flip?: boolean } = {}) => {
    setError(null)

    const check = await validateFacePhoto(file)
    if (!check.ok) {
      const err: CodedError = new Error(check.code || 'unknown')
      err.code = check.code
      setError(err)
      throw err
    }

    setUploading(true)
    try {
      const toUpload = flip ? await flipImageFile(file) : file
      const path = await uploadAvatar(toUpload)
      await saveAvatarToProfile(path)
      clearAvatarCache(path)

      const signed = await getAvatarUrl(path)
      setUrl(signed)
      return { path, url: signed }
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setUploading(false)
    }
  }, [])

  /** Flip preview only (before user confirms upload). */
  const flipFile = useCallback(async (file: Blob) => flipImageFile(file), [])

  return {
    url,
    loading,
    uploading,
    error,
    uploadValidatedAvatar,
    flipFile,
    /** Placeholder initial when url is null */
    showPlaceholder: !loading && !url,
  }
}

/**
 * Imperative cache-aware lookup for non-React callers (e.g. useChat).
 * Delegates to getAvatarUrl which already caches signed URLs for 1h.
 */
export async function resolveAvatarUrl(photoPath: string | null | undefined): Promise<string | null> {
  return getAvatarUrl(photoPath)
}
