import { t } from '../i18n'

/** Downsize large photos locally; only the prepared file is uploaded. */
export async function prepareImage(file: File, signal: AbortSignal): Promise<File> {
  const cancelled = () => { if (signal.aborted) throw new Error(t('Upload cancelled')) }
  cancelled()
  let source: ImageBitmap | HTMLImageElement
  let release: () => void
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      source = bitmap; release = () => bitmap.close()
    } else {
      const url = URL.createObjectURL(file)
      const image = new Image()
      try { image.src = url; await image.decode() } catch { URL.revokeObjectURL(url); throw new Error(t('Decode failed')) }
      source = image; release = () => URL.revokeObjectURL(url)
    }
  } catch { cancelled(); throw new Error(t('Could not prepare this image. Choose a valid JPEG, PNG or WebP.')) }
  try {
    cancelled()
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    const maxBytes = 5 * 1024 * 1024
    if (file.size <= maxBytes && Math.max(width, height) <= 2400) return file
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error(t('Image preparation is unavailable in this browser.'))
    let longest = Math.min(2400, Math.max(width, height))
    for (let attempt = 0; attempt < 4; attempt++) {
      cancelled()
      const scale = longest / Math.max(width, height)
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(t('Could not resize this image.'))), 'image/webp', .85 - attempt * .1))
      cancelled()
      if (blob.size <= maxBytes) {
        const extension = blob.type === 'image/webp' ? 'webp' : 'png'
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type, lastModified: file.lastModified })
      }
      longest = Math.round(longest * .8)
    }
    throw new Error(t('This image is still above 5 MB after resizing. Choose a smaller file.'))
  } finally { release() }
}
