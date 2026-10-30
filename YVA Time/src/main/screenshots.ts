// Captures every screen as a JPEG (one image per monitor), scaled to at most 1600 px wide.
import { desktopCapturer, screen } from 'electron'

export type Capture = { monitor: number; jpeg: Buffer; preview: string }

export async function captureScreens(): Promise<Capture[]> {
  const displays = screen.getAllDisplays()
  const width  = Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)))
  const height = Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
  return sources
    .filter(s => !s.thumbnail.isEmpty())
    .map((s, monitor) => {
      let img = s.thumbnail
      if (img.getSize().width > 1600) img = img.resize({ width: 1600, quality: 'good' })
      return { monitor, jpeg: img.toJPEG(65), preview: img.resize({ width: 320 }).toDataURL() }
    })
}
