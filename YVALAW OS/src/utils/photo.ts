// Profile photos are stored as small files in Storage (the `attachments` bucket) and the record keeps only
// the link. Before 2026-11 photos were saved inside the record as text (a 3 MB phone photo ≈ 4 MB of text),
// which every list of employees / clients downloaded on every page — see services/slimRecords.ts.
import { uploadFile } from '../services/fileStorage'

const MAX_SIDE = 320

/** A data: URL → Blob (no network) */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',', 2)
  const mime = /data:([^;,]+)/.exec(head)?.[1] || 'application/octet-stream'
  if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime })
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Shrink an image to at most 320 px on its longest side, as a JPEG (white behind transparent parts) */
export async function shrinkPhoto(src: Blob): Promise<File> {
  const url = URL.createObjectURL(src)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('This image could not be read.'))
      el.src = url
    })
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('This image could not be resized.')
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  } finally { URL.revokeObjectURL(url) }
}

/** Shrink + upload a profile photo; returns the public link to save on the record */
export async function uploadPhoto(src: Blob, folder: string): Promise<string> {
  const file = await shrinkPhoto(src)
  const { storageUrl } = await uploadFile(file, folder)
  return storageUrl
}

export const isInlineData = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:')
