import { useEffect, useState } from 'react'
import { useAvatar } from '../hooks/useAvatar'
import { validateFacePhoto } from '../lib/faceValidation'
import { flipImageFile } from '../lib/flipImage'

/**
 * Onboarding photo step helpers — wire into the existing UI:
 * - Keep using your camera / file picker
 * - Call validateFacePhoto before enable Continue
 * - "Ktheje anën" → flipPreview()
 * - On confirm → upload() (spinner via uploading)
 */
export function useOnboardingPhoto() {
  const { uploadValidatedAvatar, uploading, error } = useAvatar(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [flipped, setFlipped] = useState(false)
  const [validation, setValidation] = useState(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function setPhotoFile(nextFile) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFlipped(false)
    setFile(nextFile)
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null)
    if (nextFile) {
      setValidation(await validateFacePhoto(nextFile))
    } else {
      setValidation(null)
    }
  }

  /** "Ktheje anën" — flip with canvas, refresh preview + re-validate */
  async function flipPreview() {
    if (!file) return null
    const next = await flipImageFile(file)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(next)
    setPreviewUrl(URL.createObjectURL(next))
    setFlipped((v) => !v)
    setValidation(await validateFacePhoto(next))
    return next
  }

  /**
   * Upload after client validation. Shows spinner via `uploading`.
   * Flip already applied to `file` if user pressed "Ktheje anën".
   */
  async function upload() {
    if (!file) throw new Error('No photo selected')
    if (validation && !validation.ok) {
      throw new Error(validation.reason || 'Photo validation failed')
    }
    // flip=false: image already flipped in preview if user chose to
    return uploadValidatedAvatar(file, { flip: false })
  }

  return {
    file,
    previewUrl,
    flipped,
    validation,
    uploading,
    error,
    setPhotoFile,
    flipPreview,
    upload,
    faceOk: validation?.ok === true,
  }
}
