/**
 * HMAC-SHA256 verification for MQTT card UID messages
 *
 * Payload format from ESP32:  UID|TIMESTAMP|HMAC_HEX
 * Example: A5D3064939|1711234567|a3f9c2...
 */

const SECRET = process.env.NEXT_PUBLIC_HMAC_SECRET || ''

// Max age of a valid message — rejects replayed old messages
const MAX_AGE_SECONDS = 30

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc     = new TextEncoder()
  const keyData = enc.encode(secret)
  const msgData = enc.encode(message)

  const key = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig    = await crypto.subtle.sign('HMAC', key, msgData)
  const bytes  = new Uint8Array(sig)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  // Constant-time comparison to prevent timing attacks
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export interface ParsedUID {
  uid:       string
  timestamp: number
  valid:     boolean
  reason?:   string
}

export async function verifyAndParseUID(payload: string): Promise<ParsedUID> {
  // Support legacy plain UID (no signature) — treat as invalid if secret is set
  const parts = payload.split('|')

  if (parts.length === 1) {
    // Plain UID — no signature
    if (SECRET) {
      return { uid: payload, timestamp: 0, valid: false, reason: 'Missing signature' }
    }
    // No secret configured — allow plain UIDs (dev mode)
    return { uid: payload, timestamp: Date.now() / 1000, valid: true }
  }

  if (parts.length !== 3) {
    return { uid: '', timestamp: 0, valid: false, reason: 'Malformed payload' }
  }

  const [uid, tsStr, receivedSig] = parts
  const timestamp = parseInt(tsStr, 10)

  if (isNaN(timestamp)) {
    return { uid, timestamp: 0, valid: false, reason: 'Invalid timestamp' }
  }

  // Check message age — prevents replay attacks
  const ageSeconds = Math.floor(Date.now() / 1000) - timestamp
  if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < -5) {
    return { uid, timestamp, valid: false, reason: `Message expired (${ageSeconds}s old)` }
  }

  // Verify HMAC
  const message     = `${uid}|${tsStr}`
  const expectedSig = await hmacSha256(SECRET, message)

  if (!timingSafeEqual(expectedSig, receivedSig.toLowerCase())) {
    return { uid, timestamp, valid: false, reason: 'Invalid signature' }
  }

  return { uid, timestamp, valid: true }
}