// Resizes the pictures chosen in /admin (Website Content → Home / Landing Page Pictures,
// saved in content/pictures-*.json) for the spots they fill on the site, and writes
// assets/img/site/manifest.json for build.js, which puts them into the pages.
// Run by build.js. Output goes to assets/img/site/ (generated, not committed).
//
// "Photo" spots keep the photo's shape at a few widths (WebP); the page crops them
// with CSS (object-fit: cover) and the chosen focus becomes object-position, so the
// same files work for the different shapes a spot has on phones and computers.
// Face spots are cut to small squares here, around the chosen focus.
// File names include a hash of the source + settings: unchanged pictures are not
// re-encoded, a new picture always gets a new URL (no stale browser caches), and
// spots that use the same picture share the files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'assets/img/site');
const PUBLIC_DIR = '/assets/img/site';
const PHOTO_WIDTHS = [480, 800, 1200, 1600, 2000];
const SQUARE_SIZES = [96, 144];
const SQUARE_SPOTS = new Set(['face_1', 'face_2', 'face_3', 'review_face']);
const FOCUS = {
  center: { css: '50% 50%', sharp: 'centre' },
  top: { css: '50% 0%', sharp: 'top' },
  bottom: { css: '50% 100%', sharp: 'bottom' },
  left: { css: '0% 50%', sharp: 'left' },
  right: { css: '100% 50%', sharp: 'right' }
};

function readSpots() {
  const spots = {};
  ['pictures-home.json', 'pictures-landing.json'].forEach(file => {
    const full = path.join(ROOT, 'content', file);
    if (fs.existsSync(full)) Object.assign(spots, JSON.parse(fs.readFileSync(full, 'utf8')));
  });
  return spots;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  const keep = new Set(['manifest.json']);

  for (const [spot, entry] of Object.entries(readSpots())) {
    const image = String((entry && entry.image) || '').trim();
    if (!image) continue;
    const focus = FOCUS[entry.focus] || FOCUS.center;
    const info = { alt: String(entry.alt || '').trim(), position: focus.css };

    // A web address (not an upload) can't be resized here: used as it is.
    if (/^https?:\/\//.test(image)) {
      manifest[spot] = { ...info, src: image };
      continue;
    }
    const source = path.join(ROOT, decodeURIComponent(image.replace(/^\//, '')));
    if (!source.startsWith(ROOT) || !fs.existsSync(source)) {
      console.warn(`build-images: ${spot}: ${image} not found, keeping the page's current picture`);
      continue;
    }

    const square = SQUARE_SPOTS.has(spot);
    const bytes = fs.readFileSync(source);
    const key = crypto.createHash('sha1')
      .update(bytes).update(JSON.stringify([square, focus.sharp, PHOTO_WIDTHS, SQUARE_SIZES, 2]))
      .digest('hex').slice(0, 10);
    const meta = await sharp(bytes).metadata();
    const rotated = (meta.orientation || 1) >= 5; // EXIF says the camera was turned
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;

    // Named after the source picture, so spots sharing a picture share the files.
    const base = path.basename(source, path.extname(source)).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'picture';
    const variants = []; // { file, w, h }
    if (square) {
      SQUARE_SIZES.forEach(size => variants.push({ file: `${base}-${key}-${size}.webp`, w: size, h: size }));
    } else {
      const widths = PHOTO_WIDTHS.filter(w => w <= width);
      if (!widths.length || (width < PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1] && width > widths[widths.length - 1] * 1.15)) widths.push(width);
      widths.forEach(w => variants.push({ file: `${base}-${key}-${w}.webp`, w, h: Math.round(height * w / width) }));
    }

    for (const v of variants) {
      keep.add(v.file);
      const out = path.join(OUT_DIR, v.file);
      if (fs.existsSync(out)) continue;
      const pipeline = sharp(bytes).rotate();
      if (square) pipeline.resize(v.w, v.h, { fit: 'cover', position: focus.sharp });
      else pipeline.resize({ width: v.w });
      await pipeline.webp({ quality: square ? 82 : 78 }).toFile(out);
    }

    const middle = variants.find(v => v.w >= 800) || variants[variants.length - 1];
    const largest = variants[variants.length - 1];
    manifest[spot] = {
      ...info,
      src: `${PUBLIC_DIR}/${middle.file}`,
      srcset: variants.map(v => `${PUBLIC_DIR}/${v.file} ${v.w}w`).join(', '),
      width: largest.w,
      height: largest.h
    };
  }

  // Remove resized files no spot uses any more.
  fs.readdirSync(OUT_DIR).filter(file => !keep.has(file)).forEach(file => fs.rmSync(path.join(OUT_DIR, file)));
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built assets/img/site — ${Object.keys(manifest).length} picture(s), ${keep.size - 1} file(s)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
