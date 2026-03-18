'use client'

import { useAuth } from '@/hooks/useAuth'
import { useMQTT } from '@/hooks/useMQTT'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const { connected }        = useMQTT()
  const router               = useRouter()

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-surface/80 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-accent" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <span className="font-bold text-white tracking-tight">
          RFID<span className="text-accent">/</span>DOOR
        </span>
        {profile?.role === 'admin' && (
          <span className="text-xs font-mono bg-amber/10 text-amber border border-amber/20 px-2 py-0.5 rounded-full">
            ADMIN
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* MQTT status */}
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green dot-blink' : 'bg-muted')} />
          <span className="text-xs font-mono text-muted hidden sm:block">
            {connected ? 'MQTT' : 'Offline'}
          </span>
        </div>

        {/* user info */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-white leading-none">{profile?.name}</p>
            <p className="text-xs text-muted font-mono mt-0.5">{profile?.points ?? 0} pts</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-sm">
            {profile?.name?.[0]?.toUpperCase() || '?'}
          </div>
        </div>

        <button
          onClick={async () => { await signOut(); router.replace('/login') }}
          className="text-muted hover:text-white transition-colors"
          title="Sign out"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
          </svg>
        </button>
      </div>
    </nav>
  )
}
