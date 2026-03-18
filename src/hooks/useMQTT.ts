'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  connectMQTT, onMQTTStatus, onMQTTMessage,
  openDoor, closeDoor, publishMQTT, getMQTTConnected,
} from '@/lib/mqtt'

export function useMQTT() {
  const [connected, setConnected]   = useState(false)
  const [doorState, setDoorState]   = useState<'ON' | 'OFF' | 'UNKNOWN'>('UNKNOWN')
  const [lastUID,   setLastUID]     = useState<string | null>(null)

  useEffect(() => {
    connectMQTT()
    setConnected(getMQTTConnected())

    const unsub1 = onMQTTStatus(ok => setConnected(ok))
    const unsub2 = onMQTTMessage((topic, payload) => {
      const t = payload.trim()
      if (topic.includes('led')) {
        if (t === 'ON' || t === 'OFF') setDoorState(t)
      }
      if (topic.includes('card_uid') && /^[0-9A-Fa-f]{8}$/.test(t)) {
        setLastUID(t.toUpperCase())
      }
    })

    return () => { unsub1(); unsub2() }
  }, [])

  const triggerOpen  = useCallback(() => openDoor(),  [])
  const triggerClose = useCallback(() => closeDoor(), [])
  const publish      = useCallback(publishMQTT,       [])

  return { connected, doorState, lastUID, triggerOpen, triggerClose, publish }
}
