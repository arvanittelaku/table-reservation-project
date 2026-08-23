/**
 * Horizontally flip an image File/Blob via canvas ("Ktheje anën").
 * Returns a new JPEG File ready for uploadAvatar.
 */
export async function flipImageFile(file, fileName = 'avatar.jpg') {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to flip image'))),
      'image/jpeg',
      0.92,
    )
  })

  return new File([blob], fileName, { type: 'image/jpeg' })
}
