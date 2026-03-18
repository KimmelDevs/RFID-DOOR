'use client'

type MQTTCallback = (topic: string, payload: string) => void

const BROKER = process.env.NEXT_PUBLIC_MQTT_BROKER || 'broker.mqttdashboard.com'
const PORT   = parseInt(process.env.NEXT_PUBLIC_MQTT_PORT || '8000')

let client: any = null
let subscribers: MQTTCallback[] = []
let connected = false
let statusListeners: ((ok: boolean) => void)[] = []

function notifyStatus(ok: boolean) {
  connected = ok
  statusListeners.forEach(fn => fn(ok))
}

export function getMQTTConnected() { return connected }

export function onMQTTStatus(fn: (ok: boolean) => void) {
  statusListeners.push(fn)
  return () => { statusListeners = statusListeners.filter(f => f !== fn) }
}

export function onMQTTMessage(fn: MQTTCallback) {
  subscribers.push(fn)
  return () => { subscribers = subscribers.filter(f => f !== fn) }
}

export async function connectMQTT(): Promise<void> {
  if (typeof window === 'undefined') return
  if (client && connected) return

  const mqtt = await import('mqtt')
  const clientId = 'webapp_' + Math.random().toString(16).slice(2, 8)
  const url = `ws://${BROKER}:${PORT}/mqtt`

  client = mqtt.connect(url, { clientId, reconnectPeriod: 3000 })

  client.on('connect', () => {
    notifyStatus(true)
    const topics = [
      process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led',
      process.env.NEXT_PUBLIC_MQTT_TOPIC_UID  || 'esp32/card_uid',
    ]
    client.subscribe(topics)
  })

  client.on('disconnect', () => notifyStatus(false))
  client.on('error',      () => notifyStatus(false))
  client.on('offline',    () => notifyStatus(false))

  client.on('message', (topic: string, payload: Buffer) => {
    const msg = payload.toString()
    subscribers.forEach(fn => fn(topic, msg))
  })
}

export function publishMQTT(topic: string, payload: string) {
  if (!client || !connected) return false
  client.publish(topic, payload)
  return true
}

export function openDoor() {
  return publishMQTT(process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led', 'ON')
}

export function closeDoor() {
  return publishMQTT(process.env.NEXT_PUBLIC_MQTT_TOPIC_DOOR || 'esp32/led', 'OFF')
}
