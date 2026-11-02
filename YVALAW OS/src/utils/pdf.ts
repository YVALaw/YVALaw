// Real PDF attachments (letter size) from the same HTML the app prints: invoices (utils/invoiceHtml.ts) and
// earnings statements (utils/statementHtml.ts). jsPDF + html2canvas are loaded with import() the first time a PDF
// is made, so they never add to the app's first download (they become their own chunks).
//
// The HTML is drawn in a hidden 816 px (8.5 in at 96 dpi) iframe, captured as an image and cut into letter pages;
// page breaks are moved up to a blank row so a line of text is never sliced in half. If the drawing fails
// (an unusual font/colour html2canvas can't read), a plain-text PDF of the same document is made instead —
// a clean readable PDF beats no attachment.
import type { MimeAttachment } from './mime'

const PAGE_WIDTH_PX = 816
const PAGE_HEIGHT_PX = 1056
const MARGIN_PT = 24          // top + bottom margin of every page (side margins come from the HTML itself)

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** "Invoice HAL-0042 / ñ" → "Invoice-HAL-0042.pdf" (safe for a mail header and a download) */
export function pdfFileName(base: string): string {
  const clean = base.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document'
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`
}

async function loadFrame(html: string): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: `${PAGE_WIDTH_PX}px`, height: `${PAGE_HEIGHT_PX}px`, border: '0', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(frame)
  // No auto-print script in what we're given (callers pass autoPrint = false); values inside are escaped by the builders
  await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.srcdoc = html })
  const doc = frame.contentDocument
  if (!doc) { frame.remove(); throw new Error('Could not prepare the PDF.') }
  await Promise.all(Array.from(doc.images).map(img => img.complete ? null : new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); window.setTimeout(r, 4000) })))
  try { await doc.fonts?.ready } catch { /* fonts are optional */ }
  return { frame, doc }
}

/** True when rows [from, to) of the canvas are all (near) white */
function blankRows(canvas: HTMLCanvasElement, from: number, to: number): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
  if (!ctx || to <= from) return true
  const data = ctx.getImageData(0, from, canvas.width, to - from).data
  for (let i = 0; i < data.length; i += 16) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false
  return true
}

/** Where to end a page: inside the lowest blank gap at most 18% above the natural cut — a gap at least 10 px tall
 *  (between table rows / paragraphs) if there is one, else any blank row (between two lines), else the cut itself */
function blankRowBefore(canvas: HTMLCanvasElement, from: number, cut: number): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
  if (!ctx) return cut
  const search = Math.min(Math.floor((cut - from) * 0.18), cut - from - 1)
  if (search <= 0) return cut
  const top = cut - search
  const data = ctx.getImageData(0, top, canvas.width, search).data
  const isBlank = (y: number) => {
    const row = y * canvas.width * 4
    for (let x = 0; x < canvas.width * 4; x += 16) {          // every 4th pixel is plenty for text rows
      if (data[row + x] < 245 || data[row + x + 1] < 245 || data[row + x + 2] < 245) return false
    }
    return true
  }
  const MIN_GAP = 10 * (canvas.width / PAGE_WIDTH_PX)          // 10 CSS px at the capture scale
  let anyBlank = -1
  let run = 0
  for (let y = search - 1; y >= 0; y -= 1) {
    if (isBlank(y)) {
      run += 1
      if (anyBlank < 0) anyBlank = y
      if (run >= MIN_GAP) return top + y + Math.floor(run / 2)   // the middle of a tall gap
    } else run = 0
  }
  return anyBlank >= 0 ? top + anyBlank + 1 : cut
}

async function imagePdf(doc: Document): Promise<Uint8Array> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const root = doc.documentElement
  // The content's own height (scrollHeight is at least the frame's height, which made an empty last page)
  const body = doc.body
  const bodyBottom = body ? body.getBoundingClientRect().bottom + (parseFloat(doc.defaultView?.getComputedStyle(body).marginBottom || '0') || 0) : 0
  const height = Math.max(Math.ceil(bodyBottom), 200)
  const canvas = await html2canvas(root, {
    backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
    width: PAGE_WIDTH_PX, height, windowWidth: PAGE_WIDTH_PX, windowHeight: height, scrollX: 0, scrollY: 0,
  })
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const pxPerPt = canvas.width / pageW
  const slice = Math.floor((pageH - MARGIN_PT * 2) * pxPerPt)
  let offset = 0
  let first = true
  while (offset < canvas.height - 2 && (first || !blankRows(canvas, offset, canvas.height))) {
    const naturalEnd = Math.min(offset + slice, canvas.height)
    const end = naturalEnd >= canvas.height ? naturalEnd : blankRowBefore(canvas, offset, naturalEnd)
    const h = end - offset
    const page = document.createElement('canvas')
    page.width = canvas.width; page.height = h
    const ctx = page.getContext('2d')
    if (!ctx) throw new Error('Could not draw the PDF page.')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.width, h)
    ctx.drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h)
    if (!first) pdf.addPage()
    pdf.addImage(page.toDataURL('image/png'), 'PNG', 0, MARGIN_PT, pageW, h / pxPerPt, undefined, 'FAST')
    offset = end
    first = false
  }
  return new Uint8Array(pdf.output('arraybuffer'))
}

/** Plain text version of the document (fallback when the page can't be drawn as an image) */
async function textPdf(title: string, text: string): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true })
  const margin = 54
  const width = pdf.internal.pageSize.getWidth() - margin * 2
  const bottom = pdf.internal.pageSize.getHeight() - margin
  let y = margin
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.text(title, margin, y); y += 24
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  const lines = text.split(/\n+/).map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
  for (const line of lines) {
    for (const part of pdf.splitTextToSize(line, width) as string[]) {
      if (y > bottom) { pdf.addPage(); y = margin }
      pdf.text(part, margin, y); y += 14
    }
  }
  return new Uint8Array(pdf.output('arraybuffer'))
}

/** HTML document → PDF attachment for sendEmail (or a download on the mail-app route) */
export async function htmlToPdfAttachment(html: string, fileName: string): Promise<MimeAttachment> {
  const name = pdfFileName(fileName)
  const { frame, doc } = await loadFrame(html)
  try {
    let bytes: Uint8Array
    try {
      bytes = await imagePdf(doc)
    } catch (err) {
      console.warn('PDF drawing failed, using a text PDF instead:', err)
      bytes = await textPdf(doc.title || name.replace(/\.pdf$/i, ''), doc.body?.innerText ?? '')
    }
    return { name, mimeType: 'application/pdf', base64: bytesToBase64(bytes) }
  } finally {
    frame.remove()
  }
}
