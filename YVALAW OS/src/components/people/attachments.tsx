// People hub: file attachments on employees and candidates (images, PDFs, audio, video).
// Logic moved unchanged from EmployeeProfilePage / CandidateProfilePage / the add forms.
import { useEffect, useState } from 'react'
import type { Attachment } from '../../data/types'
import { Ic, IconPlay, P } from '../Icon'
import { Menu } from '../ui'

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'wmv', '3gp']
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma']
const fileExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export const isVideo = (att: Attachment) => att.mimeType.startsWith('video') || VIDEO_EXTS.includes(fileExt(att.name))
export const isAudio = (att: Attachment) => att.mimeType.startsWith('audio') || AUDIO_EXTS.includes(fileExt(att.name))
export const isImage = (att: Attachment) => att.mimeType.startsWith('image')
export const attUrl = (att: Attachment) => att.storageUrl || att.dataUrl
export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

/** Short label on the file tile (PDF / IMG / MP4…) */
export function fileTag(name: string, mime?: string | null): string {
  const ext = fileExt(name)
  if (ext && ext.length <= 4) return ext.toUpperCase()
  if (mime?.startsWith('image')) return 'IMG'
  if (mime === 'application/pdf') return 'PDF'
  return 'FILE'
}

/** Force a download (octet-stream) so PDFs and videos save instead of opening in the browser */
export async function downloadAttachment(url: string, name: string) {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const forceBlob = new Blob([blob], { type: 'application/octet-stream' })
    const blobUrl = URL.createObjectURL(forceBlob)
    const a = document.createElement('a')
    a.href = blobUrl; a.download = name
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
  } catch { window.open(url, '_blank') }
}

/** fetch → blob → object URL, which gets around Supabase Storage refusing range requests cross-origin */
export function VideoPlayer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])
  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      setBlobUrl(URL.createObjectURL(blob))
    } catch { /* ignore */ } finally { setLoading(false) }
  }
  if (blobUrl) return <video className="ppl-video" controls autoPlay src={blobUrl} />
  return (
    <button type="button" className="ppl-video-load" onClick={() => void load()} disabled={loading}>
      {loading ? 'Loading video…' : <><IconPlay size={14} /> Click to load video</>}
    </button>
  )
}

/** One row per file: tile, name + size/date, inline audio/video/image, download, ⋯ remove */
export function AttachmentList({ items, onRemove, empty, compact }: { items: Attachment[]; onRemove?: (id: string) => void; empty?: string; compact?: boolean }) {
  if (items.length === 0) return empty ? <div className="ppl-empty-line">{empty}</div> : null
  return (
    <div className="ppl-files">
      {items.map(att => {
        const url = attUrl(att)
        return (
          <div key={att.id} className="ppl-file">
            <div className="ppl-file__row">
              {isImage(att) && url
                ? <img className="ppl-file__thumb" src={url} alt="" />
                : <span className="ppl-file__tag mono">{fileTag(att.name, att.mimeType)}</span>}
              <div className="ppl-file__main">
                <span className="ppl-file__name">{att.name}</span>
                <span className="ppl-file__meta">{fileSize(att.size)}{att.uploadedAt ? ` · ${new Date(att.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
              </div>
              {!compact && isAudio(att) && <audio className="ppl-audio" controls src={url} />}
              <button type="button" className="btn btn--sm btn--ghost" aria-label={`Download ${att.name}`} onClick={() => void downloadAttachment(url, att.name)}>
                <Ic d={P.download} size={15} /><span className="hide-phone">Download</span>
              </button>
              {onRemove && <Menu label={`More actions for ${att.name}`} buttonClass="btn btn--icon btn--sm btn--ghost" items={[{ label: 'Remove file', icon: P.trash, danger: true, onClick: () => onRemove(att.id) }]} />}
            </div>
            {compact && isAudio(att) && <audio className="ppl-audio ppl-audio--block" controls src={url} />}
            {isVideo(att) && <VideoPlayer url={url} />}
          </div>
        )
      })}
    </div>
  )
}
