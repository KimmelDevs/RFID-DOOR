'use client'

import { useState } from 'react'
import { useMQTT } from '@/hooks/useMQTT'
import clsx from 'clsx'

interface Props {
  points: number
  costPerOpen?: number
  onPointsSpent?: (amount: number) => void
  adminMode?: boolean
}

export default function DoorControl({ points, costPerOpen = 1, onPointsSpent, adminMode = false }: Props) {
  const { connected, doorState, triggerOpen, triggerClose } = useMQTT()
  const [busy,    setBusy]    = useState(false)
  const [message, setMessage] = useState('')

  const canOpen = adminMode || points >= costPerOpen

  const handleOpen = async () => {
    if (!connected) { setMessage('Not connected to MQTT'); return }
    if (!canOpen)   { setMessage('Insufficient points'); return }
    setBusy(true)
    setMessage('')
    const ok = triggerOpen()
    if (ok) {
      if (!adminMode && onPointsSpent) onPointsSpent(costPerOpen)
      setMessage(adminMode ? 'Door opened (admin)' : `Door opened — ${costPerOpen} pt used`)
    } else {
      setMessage('Failed to send command')
    }
    setBusy(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleClose = async () => {
    if (!connected) { setMessage('Not connected to MQTT'); return }
    setBusy(true)
    triggerClose()
    setMessage('Door closed')
    setBusy(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const isOpen    = doorState === 'ON'
  const isClosed  = doorState === 'OFF'
  const isUnknown = doorState === 'UNKNOWN'

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-6">
      {/* Door visual */}
      <div className="flex flex-col items-center gap-4">
        <div className={clsx(
          'relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500',
          isOpen    && 'bg-green/10 border-2 border-green glow-green',
          isClosed  && 'bg-accent/10 border-2 border-accent glow-cyan',
          isUnknown && 'bg-border border-2 border-dim',
        )}>
          {isOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-14 h-14 text-green">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 019.9-1"/>
            </svg>
          ) : isClosed ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-14 h-14 text-accent">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-14 h-14 text-muted">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 8v4l3 3"/>
            </svg>
          )}
          {/* pulse ring when open */}
          {isOpen && (
            <span className="absolute inset-0 rounded-full border-2 border-green animate-ping opacity-30" />
          )}
        </div>

        <div className="text-center">
          <p className={clsx(
            'text-lg font-bold tracking-widest font-mono',
            isOpen    && 'text-green',
            isClosed  && 'text-accent',
            isUnknown && 'text-muted',
          )}>
            {isOpen ? 'DOOR OPEN' : isClosed ? 'DOOR CLOSED' : 'UNKNOWN'}
          </p>
          {!adminMode && (
            <p className="text-muted text-xs mt-1 font-mono">
              {points} pts available · {costPerOpen} pt per open
            </p>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleOpen}
          disabled={busy || !connected || !canOpen}
          className={clsx(
            'py-3 rounded-xl font-bold text-sm transition-all',
            canOpen && connected
              ? 'bg-green hover:opacity-90 text-bg'
              : 'bg-dim text-muted cursor-not-allowed',
          )}>
          {busy ? '…' : 'Open Door'}
        </button>
        <button
          onClick={handleClose}
          disabled={busy || !connected}
          className={clsx(
            'py-3 rounded-xl font-bold text-sm transition-all border',
            connected
              ? 'border-border hover:border-accent hover:text-accent text-white'
              : 'border-dim text-muted cursor-not-allowed',
          )}>
          {busy ? '…' : 'Close Door'}
        </button>
      </div>

      {/* Message */}
      {message && (
        <p className={clsx(
          'text-xs font-mono text-center px-3 py-2 rounded-lg',
          message.includes('Insufficient') || message.includes('Failed') || message.includes('Not')
            ? 'bg-red/10 text-red border border-red/20'
            : 'bg-green/10 text-green border border-green/20',
        )}>
          {message}
        </p>
      )}

      {/* MQTT status */}
      {!connected && (
        <div className="flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-muted" />
          <span className="text-xs font-mono text-muted">MQTT disconnected</span>
        </div>
      )}
    </div>
  )
}
