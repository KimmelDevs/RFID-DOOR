'use client'

type MQTTCallback = (topic: string, payload: string) => void

const BROKER = process.env.NEXT_PUBLIC_MQTT_BROKER    || 'broker.mqttdashboard.com'
const PORT   = parseInt(process.env.NEXT_PUBLIC_MQTT_PORT || '8000')

let client:          any                              = null
let subscribers:     MQTTCallback[]                   = []
let connected        = false
let statusListeners: ((ok: boolean) => void)[]        = []
let connecting       = false

function notifyStatus(ok: boolean) {
  connected = ok
  statusListeners.forEach(fn => fn(ok))
}

export function getMQTTConnected() { return connected }

export function onMQTTStatus(fn: (ok: boolean) => void) {
  statusListeners.push(fn)
  fn(connected)
  return () => { statusListeners = statusListeners.filter(f => f !== fn) }
}

export function onMQTTMessage(fn: MQTTCallback) {
  subscribers.push(fn)
  return () => { subscribers = subscribers.filter(f => f !== fn) }
}

export async function connectMQTT(): Promise<void> {
  if (typeof window === 'undefined') return
  if (connecting || (client && connected)) return
  connecting = true

  try {
    const mqttLib: any = await import('mqtt')

    const connectFn: ((url: string, opts: any) => any) | undefined =
      typeof mqttLib.connect            === 'function' ? mqttLib.connect :
      typeof mqttLib.default?.connect   === 'function' ? mqttLib.default.connect :
      typeof mqttLib.default            === 'function' ? mqttLib.default :
      undefined

    if (!connectFn) {
      console.error('[MQTT] connect fn not found. Keys:', Object.keys(mqttLib))
      connecting = false
      return
    }

    const clientId = 'webapp_' + Math.random().toString(16).slice(2, 8)
    const url      = `ws://${BROKER}:${PORT}/mqtt`

    client = connectFn(url, {
      clientId,
      reconnectPeriod: 3000,
      keepalive: 60,
      clean: true,
    })

    client.on('connect', () => {
      notifyStatus(true)
      connecting = false
      client.subscribe([
        process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led',
        process.env.NEXT_PUBLIC_MQTT_TOPIC_UID  || 'esp32/card_uid',
      ], () => {})
    })

    client.on('reconnect',   () => notifyStatus(false))
    client.on('disconnect',  () => { notifyStatus(false); connecting = false })
    client.on('error',       (e: any) => { console.warn('[MQTT]', e.message); notifyStatus(false); connecting = false })
    client.on('offline',     () => { notifyStatus(false); connecting = false })

    client.on('message', (topic: string, payload: Buffer) => {
      subscribers.forEach(fn => fn(topic, payload.toString()))
    })
  } catch (err) {
    console.error('[MQTT] module load error', err)
    connecting = false
  }
}

export function publishMQTT(topic: string, payload: string): boolean {
  if (!client || !connected) return false
  client.publish(topic, payload)
  return true
}

export function openDoor()  { return publishMQTT(process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led', 'ON')  }
export function closeDoor() { return publishMQTT(process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led', 'OFF') }