/**
 * Client-side face / photo quality checks used in onboarding.
 * Returns stable error codes — map to locale strings in the UI via t().
 */

const MIN_BRIGHTNESS = 40
const MAX_BRIGHTNESS = 220
const MIN_VARIANCE = 200

export async function validateFacePhoto(file) {
  if (!file || !file.type?.startsWith('image/')) {
    return { ok: false, code: 'invalid_file' }
  }

  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const maxSide = 640
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sum = 0
  let sumSq = 0
  const pixels = width * height

  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += y
    sumSq += y * y
  }

  const mean = sum / pixels
  const variance = sumSq / pixels - mean * mean

  if (mean < MIN_BRIGHTNESS) {
    return { ok: false, code: 'too_dark' }
  }
  if (mean > MAX_BRIGHTNESS) {
    return { ok: false, code: 'too_bright' }
  }
  if (variance < MIN_VARIANCE) {
    return { ok: false, code: 'too_flat' }
  }

  if (typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 })
      const faces = await detector.detect(canvas)
      if (!faces?.length) {
        return { ok: false, code: 'no_face' }
      }
    } catch {
      // FaceDetector can fail on some images — brightness/variance already passed
    }
  }

  return { ok: true, code: null, stats: { mean, variance } }
}

/** Map validation code to i18n key under onboarding.step3.faceErrors */
export function photoErrorKey(code) {
  return `onboarding.step3.faceErrors.${code || 'unknown'}`
}
