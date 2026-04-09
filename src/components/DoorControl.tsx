'use client'

import { useState } from 'react'
import { useMQTT } from '@/hooks/useMQTT'
import clsx from 'clsx'

interface Props {
  points:       number
  costPerOpen?: number
  onPointsSpent?: (amount: number) => void
  adminMode?: boolean
}

export default function DoorControl({ points, costPerOpen = 1, onPointsSpent, adminMode = false }: Props) {
  const { connected, doorState, roofState, triggerOpen, triggerClose, triggerOpenRoof, triggerCloseRoof } = useMQTT()
  const [busy,    setBusy]    = useState(false)
  const [message, setMessage] = useState('')

  const canOpen = adminMode || points >= costPerOpen

  // ── Door handlers ──────────────────────────────────────────────────────────
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

  // ── Roof handlers ──────────────────────────────────────────────────────────
  const handleOpenRoof = async () => {
    if (!connected) { setMessage('Not connected to MQTT'); return }
    setBusy(true)
    triggerOpenRoof()
    setMessage('Roof opened')
    setBusy(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleCloseRoof = async () => {
    if (!connected) { setMessage('Not connected to MQTT'); return }
    setBusy(true)
    triggerCloseRoof()
    setMessage('Roof closed')
    setBusy(false)
    setTimeout(() => setMessage(''), 3000)
  }

  const isOpen    = doorState === 'ON'
  const isClosed  = doorState === 'OFF'
  const isUnknown = doorState === 'UNKNOWN'

  const isRoofOpen    = roofState === 'ON'
  const isRoofClosed  = roofState === 'OFF'
  const isRoofUnknown = roofState === 'UNKNOWN'

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-6">

      {/* ── DOOR SECTION ───────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted self-start">Door</p>
        <div className={clsx(
          'relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500',
          isOpen    && 'bg-green/10 border-2 border-green glow-green',
          isClosed  && 'bg-accent/10 border-2 border-accent glow-cyan',
          isUnknown && 'bg-border border-2 border-dim',
        )}>
          {isOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-green">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 019.9-1"/>
            </svg>
          ) : isClosed ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-accent">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-muted">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 8v4l3 3"/>
            </svg>
          )}
          {isOpen && (
            <span className="absolute inset-0 rounded-full border-2 border-green animate-ping opacity-30" />
          )}
        </div>

        <p className={clsx(
          'text-base font-bold tracking-widest font-mono',
          isOpen    && 'text-green',
          isClosed  && 'text-accent',
          isUnknown && 'text-muted',
        )}>
          {isOpen ? 'DOOR OPEN' : isClosed ? 'DOOR CLOSED' : 'UNKNOWN'}
        </p>
        {!adminMode && (
          <p className="text-muted text-xs font-mono">
            {points} pts available · {costPerOpen} pt per open
          </p>
        )}
      </div>

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

      {/* ── DIVIDER ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-border" />

      {/* ── ROOF SECTION ───────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted self-start">Roof</p>
        <div className={clsx(
          'relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500',
          isRoofOpen    && 'bg-amber/10 border-2 border-amber',
          isRoofClosed  && 'bg-accent/10 border-2 border-accent glow-cyan',
          isRoofUnknown && 'bg-border border-2 border-dim',
        )}>
          {/* Roof icon — house with open/closed roof */}
          {isRoofOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-amber">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 3l9 6.5"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V12h6v9"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5v-.5" opacity="0.4"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3V1M9 2l3-1 3 1" strokeDasharray="2 1"/>
            </svg>
          ) : isRoofClosed ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 3l9 6.5"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V12h6v9"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5H21"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-12 h-12 text-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 3l9 6.5"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V12h6v9"/>
            </svg>
          )}
          {isRoofOpen && (
            <span className="absolute inset-0 rounded-full border-2 border-amber animate-ping opacity-30" />
          )}
        </div>

        <p className={clsx(
          'text-base font-bold tracking-widest font-mono',
          isRoofOpen    && 'text-amber',
          isRoofClosed  && 'text-accent',
          isRoofUnknown && 'text-muted',
        )}>
          {isRoofOpen ? 'ROOF OPEN' : isRoofClosed ? 'ROOF CLOSED' : 'UNKNOWN'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleOpenRoof}
          disabled={busy || !connected}
          className={clsx(
            'py-3 rounded-xl font-bold text-sm transition-all',
            connected
              ? 'bg-amber hover:opacity-90 text-bg'
              : 'bg-dim text-muted cursor-not-allowed',
          )}>
          {busy ? '…' : 'Open Roof'}
        </button>
        <button
          onClick={handleCloseRoof}
          disabled={busy || !connected}
          className={clsx(
            'py-3 rounded-xl font-bold text-sm transition-all border',
            connected
              ? 'border-border hover:border-amber hover:text-amber text-white'
              : 'border-dim text-muted cursor-not-allowed',
          )}>
          {busy ? '…' : 'Close Roof'}
        </button>
      </div>

      {/* ── Message ──────────────────────────────────────────────────────────── */}
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

      {/* ── MQTT status ──────────────────────────────────────────────────────── */}
      {!connected && (
        <div className="flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-muted" />
          <span className="text-xs font-mono text-muted">MQTT disconnected</span>
        </div>
      )}
    </div>
  )
}