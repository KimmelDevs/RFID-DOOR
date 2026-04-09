/**
 * rfidBrain.ts  — singleton RFID door controller
 *
 * Lives outside React entirely. Initialized once, never re-subscribes.
 * React components just read state via the callback they register.
 */
import { onMQTTMessage, publishMQTT, connectMQTT } from './mqtt'
import { verifyAndParseUID } from './hmac'
import { findUserByCardUid, adjustPoints } from './firestore'

const DOOR_TOPIC   = 'esp32/led'
const COST_PER_OPEN = 1

export type ScanEvent =
  | { type: 'idle' }
  | { type: 'scanning'; uid: string }
  | { type: 'granted';  uid: string; name: string; points: number }
  | { type: 'denied';   uid: string; reason: string }
  | { type: 'unknown';  uid: string }

export type ScanLogEntry = (
  | { type: 'granted'; uid: string; name: string; points: number }
  | { type: 'denied';  uid: string; reason: string }
  | { type: 'unknown'; uid: string }
) & { time: string }

type Listener = (event: ScanEvent, log: ScanLogEntry[]) => void

// ── singleton state ───────────────────────────────────────────────────────────
let initialized     = false
let processing      = false
let doorOpen        = false
let countdownTimer: ReturnType<typeof setInterval> | null = null
let countdown       = 0
let lastPayload     = ''
let scanLog: ScanLogEntry[] = []
let listeners: Listener[] = []
let onCountdownTick: ((n: number | null) => void) | null = null
let onToast: ((msg: string) => void) | null = null

function notify(event: ScanEvent) {
  listeners.forEach(fn => fn(event, [...scanLog]))
}

export function registerListener(fn: Listener) {
  if (!listeners.includes(fn)) listeners.push(fn)
  return () => { listeners = listeners.filter(f => f !== fn) }
}

export function registerCountdownListener(fn: (n: number | null) => void) {
  onCountdownTick = fn
}

export function registerToastListener(fn: (msg: string) => void) {
  onToast = fn
}

export function clearScanLog() {
  scanLog = []
  notify({ type: 'idle' })
}

export function isDoorOpen() { return doorOpen }

function startCountdown(seconds = 60) {
  if (countdownTimer) clearInterval(countdownTimer)
  doorOpen = true
  countdown = seconds
  onCountdownTick?.(countdown)
  countdownTimer = setInterval(() => {
    countdown -= 1
    onCountdownTick?.(countdown)
    if (countdown <= 0) {
      clearInterval(countdownTimer!)
      countdownTimer = null
      doorOpen = false
      onCountdownTick?.(null)
      publishMQTT(DOOR_TOPIC, 'OFF')
      onToast?.('Auto-closed after 60s')
    }
  }, 1000)
}

export function forceOpen() {
  publishMQTT(DOOR_TOPIC, 'ON')
  startCountdown(60)
  onToast?.('Door opened — auto-closes in 60s')
}

export function forceClose() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  doorOpen = false
  onCountdownTick?.(null)
  publishMQTT(DOOR_TOPIC, 'OFF')
  onToast?.('Door closed')
}

// ── init — called once ────────────────────────────────────────────────────────
export function initRFIDBrain() {
  if (initialized) return
  initialized = true

  connectMQTT()

  onMQTTMessage(async (topic, payload) => {
    const t = payload.trim()
    if (!topic.includes('card_uid')) return

    // deduplicate — same payload within 8 s is ignored
    if (t === lastPayload) return
    if (processing) return

    processing   = true
    lastPayload  = t
    // auto-clear dedup after 8 s
    setTimeout(() => { if (lastPayload === t) lastPayload = '' }, 8000)

    const parsed = await verifyAndParseUID(t)
    if (!parsed.valid) {
      processing = false
      return
    }

    const uid = parsed.uid.toUpperCase()
    const now = new Date().toLocaleTimeString('en-PH', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })

    notify({ type: 'scanning', uid })

    try {
      const cardOwner = await findUserByCardUid(uid)

      if (!cardOwner) {
        publishMQTT(DOOR_TOPIC, 'DENY')
        const ev: ScanEvent = { type: 'unknown', uid }
        scanLog = [{ ...ev, time: now } as ScanLogEntry, ...scanLog.slice(0, 49)]
        notify(ev)
        setTimeout(() => notify({ type: 'idle' }), 5000)
        processing = false
        return
      }

      if (doorOpen) {
        // card scan while open → close
        forceClose()
        const ev: ScanEvent = { type: 'granted', uid, name: `${cardOwner.name} (closed door)`, points: cardOwner.points ?? 0 }
        scanLog = [{ type: 'granted', uid, name: `${cardOwner.name} — closed door`, points: cardOwner.points ?? 0, time: now }, ...scanLog.slice(0, 49)]
        notify(ev)
        setTimeout(() => notify({ type: 'idle' }), 4000)
        processing = false
        return
      }

      if ((cardOwner.points ?? 0) < COST_PER_OPEN) {
        publishMQTT(DOOR_TOPIC, 'DENY')
        const ev: ScanEvent = { type: 'denied', uid, reason: `Insufficient points (${cardOwner.points ?? 0} pts)` }
        scanLog = [{ ...ev, time: now } as ScanLogEntry, ...scanLog.slice(0, 49)]
        notify(ev)
        setTimeout(() => notify({ type: 'idle' }), 5000)
        processing = false
        return
      }

      // open door
      publishMQTT(DOOR_TOPIC, 'ON')
      startCountdown(60)

      await adjustPoints(
        cardOwner.uid, -COST_PER_OPEN,
        'Door opened via RFID card',
        'system', 'System', cardOwner.name,
      )

      const ev: ScanEvent = { type: 'granted', uid, name: cardOwner.name, points: (cardOwner.points ?? 0) - COST_PER_OPEN }
      scanLog = [{ ...ev, time: now } as ScanLogEntry, ...scanLog.slice(0, 49)]
      notify(ev)
      setTimeout(() => notify({ type: 'idle' }), 5000)

    } catch (err) {
      console.error('[RFIDBrain]', err)
      notify({ type: 'idle' })
    }

    processing = false
  })
}