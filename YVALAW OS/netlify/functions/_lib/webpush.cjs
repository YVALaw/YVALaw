/**
 * Web Push (phone / computer notifications) with Node's built-in crypto — no extra package.
 *   • VAPID (RFC 8292): ES256-signed JWT identifying YVA OS to the push service
 *   • Message encryption (RFC 8291, "aes128gcm"): only the subscribed browser can read it
 * Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars if set, otherwise created once and kept
 * in the server-only app_secrets table (nothing to set up).
 */
const crypto = require('node:crypto')
const { rest } = require('./supa.cjs')

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) }
}

let cached = null
/** { publicKey, privateKey } (base64url: 65-byte uncompressed point / 32-byte scalar) */
async function vapidKeys() {
  if (cached) return cached
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    return cached
  }
  const read = async () => {
    const rows = await rest('app_secrets?key=in.(vapid_public,vapid_private)&select=key,value')
    const m = Object.fromEntries(rows.map(r => [r.key, r.value]))
    return m.vapid_public && m.vapid_private ? { publicKey: m.vapid_public, privateKey: m.vapid_private } : null
  }
  let keys = await read()
  if (!keys) {
    const k = generateVapidKeys()
    // ignore-duplicates: if two requests race, the first keys win and both read them back
    await rest('app_secrets', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }] })
    keys = await read()
  }
  cached = keys
  return keys
}

function vapidPrivateKeyObject(keys) {
  const pub = fromB64url(keys.publicKey)
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64url(fromB64url(keys.privateKey)), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: 'jwk' })
}

function vapidAuthHeader(endpoint, keys, subject = 'mailto:contact@yvastaffing.agency') {
  const aud = new URL(endpoint).origin
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidPrivateKeyObject(keys), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`
}

/** RFC 8291 aes128gcm body for one subscription ({ p256dh, auth } base64url) */
function encrypt(payload, sub) {
  const uaPublic = fromB64url(sub.p256dh)
  const authSecret = fromB64url(sub.auth)
  const as = crypto.createECDH('prime256v1')
  as.generateKeys()
  const asPublic = as.getPublicKey()
  const shared = as.computeSecret(uaPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const salt = crypto.randomBytes(16)
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])    // 0x02 = last record
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct])
}

/**
 * Send one push. Returns 'ok' | 'gone' (subscription expired: delete it) | 'error'.
 * payload: { title, body, url, tag }
 */
async function sendPush(sub, payload, keys) {
  const k = keys || await vapidKeys()
  const body = encrypt(JSON.stringify(payload), sub)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidAuthHeader(sub.endpoint, k), TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body,
  }).catch(() => null)
  if (!res) return 'error'
  if (res.status === 404 || res.status === 410) return 'gone'
  return res.ok ? 'ok' : 'error'
}

module.exports = { vapidKeys, sendPush, encrypt, vapidAuthHeader, generateVapidKeys, b64url, fromB64url }
