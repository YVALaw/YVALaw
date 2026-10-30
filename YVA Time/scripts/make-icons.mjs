// One-off: makes the app/installer icon and the tray icons from the YVA logo.
// Run from the repo root after `npm install` there (uses the site's sharp):
//   node "YVA Time/scripts/make-icons.mjs"
// The PNGs it writes are committed, so normal builds don't need this.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(here, '..')
const repo = path.resolve(app, '..')
const sharp = createRequire(path.join(repo, 'package.json'))('sharp')
const logo = path.join(repo, 'YVALAW OS', 'public', 'yva-logo.png')

await sharp(logo).resize(256, 256).png().toFile(path.join(app, 'build', 'icon.png'))
await sharp(logo).resize(256, 256).png().toFile(path.join(app, 'resources', 'icon.png'))

const dots = { active: '#16a34a', idle: '#ea580c', stopped: '#9ca3af' }
for (const [name, color] of Object.entries(dots)) {
  for (const [suffix, size] of [['', 16], ['@2x', 32]]) {
    const r = Math.round(size * 0.22)
    const dot = Buffer.from(
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${size - r - 0.5}" cy="${size - r - 0.5}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="${size / 16}"/></svg>`)
    await sharp(logo).resize(size, size).composite([{ input: dot }]).png()
      .toFile(path.join(app, 'resources', `tray-${name}${suffix}.png`))
  }
}
console.log('icons written')
