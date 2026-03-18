'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import {
  listenUser, listenUserTransactions,
  Transaction, UserProfile,
  adjustPoints, updateUserProfile,
  findUserByCardUid,
} from '@/lib/firestore'
import { onMQTTMessage, publishMQTT, getMQTTConnected, connectMQTT } from '@/lib/mqtt'
import { useMQTT } from '@/hooks/useMQTT'
import Navbar from '@/components/Navbar'
import DoorControl from '@/components/DoorControl'
import TransactionList from '@/components/TransactionList'
import StatCard from '@/components/StatCard'
import clsx from 'clsx'

const COST_PER_OPEN  = 1
const DOOR_TOPIC     = 'esp32/led'

type ScanStatus =
  | { type: 'idle' }
  | { type: 'scanning' }
  | { type: 'success';  uid: string; message: string }
  | { type: 'denied';   uid: string; message: string }
  | { type: 'unknown';  uid: string }
  | { type: 'saving';   uid: string }
  | { type: 'saved';    uid: string }

export default function DashboardPage() {
  const { user, profile: authProfile, loading } = useAuth()
  const router = useRouter()
  const { connected, doorState } = useMQTT()

  const [profile,      setProfile]      = useState<UserProfile | null>(null)
  const [txs,          setTxs]          = useState<Transaction[]>([])
  const [scanStatus,   setScanStatus]   = useState<ScanStatus>({ type: 'idle' })
  const [registerMode, setRegisterMode] = useState(false)

  // Refs so the MQTT callback always reads latest values without re-subscribing
  const profileRef      = useRef<UserProfile | null>(null)
  const registerModeRef = useRef(false)
  const processingRef   = useRef(false)

  useEffect(() => { profileRef.current      = profile      }, [profile])
  useEffect(() => { registerModeRef.current = registerMode }, [registerMode])

  // redirect guards
  useEffect(() => {
    if (!loading && !user)                         router.replace('/login')
    if (!loading && authProfile?.role === 'admin') router.replace('/admin')
  }, [user, authProfile, loading, router])

  // real-time profile
  useEffect(() => {
    if (!user) return
    return listenUser(user.uid, p => setProfile(p))
  }, [user])

  // real-time transactions
  useEffect(() => {
    if (!user) return
    return listenUserTransactions(user.uid, setTxs)
  }, [user])

  // ── RFID scan handler — subscribe ONCE, use refs for fresh state ────────────
  useEffect(() => {
    if (!user) return

    connectMQTT()

    const unsub = onMQTTMessage(async (topic, payload) => {
      const t = payload.trim()

      // Only handle card UID messages (8 or 10 hex chars)
      if (!topic.includes('card_uid')) return
      if (!/^[0-9A-Fa-f]{8,10}$/.test(t)) return

      // Debounce — ignore if already handling a scan
      if (processingRef.current) return
      processingRef.current = true
      setScanStatus({ type: 'scanning' })

      const uid = t.toUpperCase()

      try {
        // ── REGISTER MODE ──────────────────────────────────────────────────
        if (registerModeRef.current) {
          setScanStatus({ type: 'saving', uid })
          await updateUserProfile(user.uid, { cardUid: uid })
          setScanStatus({ type: 'saved', uid })
          setRegisterMode(false)
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // ── NORMAL MODE: look up card ──────────────────────────────────────
        const cardOwner = await findUserByCardUid(uid)

        if (!cardOwner) {
          setScanStatus({ type: 'unknown', uid })
          setTimeout(() => setScanStatus({ type: 'idle' }), 5000)
          processingRef.current = false
          return
        }

        if (cardOwner.uid !== user.uid) {
          setScanStatus({ type: 'denied', uid, message: 'Card belongs to a different account' })
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        if ((cardOwner.points ?? 0) < COST_PER_OPEN) {
          setScanStatus({ type: 'denied', uid, message: `Not enough points (have ${cardOwner.points ?? 0}, need ${COST_PER_OPEN})` })
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // ✅ Grant access — publish ON directly, then deduct points
        const sent = publishMQTT(DOOR_TOPIC, 'ON')
        console.log('[RFID] publishMQTT ON →', sent, '| MQTT connected:', getMQTTConnected())

        if (!sent) {
          // MQTT not ready yet — retry once after short delay
          await new Promise(r => setTimeout(r, 600))
          const retry = publishMQTT(DOOR_TOPIC, 'ON')
          console.log('[RFID] retry publish →', retry)
        }

        await adjustPoints(
          user.uid,
          -COST_PER_OPEN,
          'Door opened via RFID card',
          'system',
          'System',
          cardOwner.name,
        )

        setScanStatus({ type: 'success', uid, message: `Welcome, ${cardOwner.name}! −${COST_PER_OPEN} pt` })
        setTimeout(() => setScanStatus({ type: 'idle' }), 5000)

      } catch (err) {
        console.error('[RFID] handler error', err)
        setScanStatus({ type: 'idle' })
      }

      processingRef.current = false
    })

    // cleanup only on unmount / user change — NOT on every processing toggle
    return unsub
  }, [user]) // ← no `processing` dep here

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalCredits = txs.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const totalDebits  = txs.filter(t => t.type === 'debit').reduce((s, t)  => s + t.amount, 0)
  const opens        = txs.filter(t => t.type === 'debit').length

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8 animate-slide-up">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">
            Hey, <span className="text-accent">{profile.name}</span> 👋
          </h1>
          <p className="text-muted text-sm mt-1">
            Use your RFID card or the button below to unlock the door
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Points"       value={profile.points} sub="available" color="cyan"  />
          <StatCard label="Total Earned" value={totalCredits}   sub="all time"  color="green" />
          <StatCard label="Total Used"   value={totalDebits}    sub="all time"  color="amber" />
          <StatCard label="Door Opens"   value={opens}          sub="all time"  color="red"   />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div className="lg:col-span-1 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">Manual Control</h2>
              <DoorControl
                points={profile.points}
                costPerOpen={COST_PER_OPEN}
                onPointsSpent={async (amt) => {
                  if (!user || !profile) return
                  await adjustPoints(user.uid, -amt, 'Door opened via app', 'system', 'System', profile.name)
                }}
              />
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">RFID Card</h2>
              <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted font-mono uppercase tracking-widest mb-1">Linked Card</p>
                    {profile.cardUid ? (
                      <p className="text-accent font-mono font-bold tracking-widest text-sm">{profile.cardUid}</p>
                    ) : (
                      <p className="text-muted text-sm italic">No card linked</p>
                    )}
                  </div>
                  {profile.cardUid && (
                    <div className="w-8 h-8 rounded-lg bg-green/10 border border-green/20 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-green">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                    </div>
                  )}
                </div>

                <ScanStatusPanel
                  status={scanStatus}
                  registerMode={registerMode}
                  onToggleRegister={() => {
                    setRegisterMode(r => !r)
                    setScanStatus({ type: 'idle' })
                  }}
                  hasCard={!!profile.cardUid}
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Transaction History</h2>
              <span className="text-xs font-mono text-muted">{txs.length} records</span>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-4 max-h-[520px] overflow-y-auto">
              <TransactionList transactions={txs} />
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}

// ── Scan Status Panel ─────────────────────────────────────────────────────────
function ScanStatusPanel({ status, registerMode, onToggleRegister, hasCard }: {
  status: ScanStatus
  registerMode: boolean
  onToggleRegister: () => void
  hasCard: boolean
}) {
  if (registerMode) {
    return (
      <div className="space-y-3">
        <div className="relative flex flex-col items-center justify-center gap-3 bg-accent/5 border border-accent/20 rounded-xl py-6 overflow-hidden">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-2 border-accent flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-accent">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <path strokeLinecap="round" d="M2 10h20"/>
              </svg>
            </div>
            <span className="absolute inset-0 rounded-full border-2 border-accent animate-ping opacity-30" />
          </div>
          <div className="text-center">
            <p className="text-accent font-semibold text-sm">Scan your RFID card now</p>
            <p className="text-muted text-xs mt-1 font-mono">Hold card near the reader</p>
          </div>
          {status.type === 'saving' && (
            <div className="absolute inset-0 bg-bg/80 flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-accent text-sm font-mono">Saving…</span>
            </div>
          )}
        </div>
        <button onClick={onToggleRegister}
          className="w-full py-2 rounded-xl border border-border text-muted hover:text-white hover:border-dim text-sm font-semibold transition-all">
          Cancel
        </button>
      </div>
    )
  }

  const resultPanel = () => {
    if (status.type === 'scanning') return (
      <div className="flex items-center gap-3 bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-accent text-sm font-mono">Reading card…</span>
      </div>
    )
    if (status.type === 'success') return (
      <div className="flex items-start gap-3 bg-green/5 border border-green/20 rounded-xl px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-green flex-shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p className="text-green text-sm font-semibold">{status.message}</p>
          <p className="text-muted text-xs font-mono mt-0.5">UID: {status.uid}</p>
        </div>
      </div>
    )
    if (status.type === 'denied') return (
      <div className="flex items-start gap-3 bg-red/5 border border-red/20 rounded-xl px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-red flex-shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p className="text-red text-sm font-semibold">Access Denied</p>
          <p className="text-muted text-xs font-mono mt-0.5">{status.message}</p>
        </div>
      </div>
    )
    if (status.type === 'unknown') return (
      <div className="flex items-start gap-3 bg-amber/5 border border-amber/20 rounded-xl px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-amber flex-shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p className="text-amber text-sm font-semibold">Card not registered</p>
          <p className="text-muted text-xs font-mono mt-0.5">UID: {status.uid}</p>
          <p className="text-muted text-xs mt-1">Use "Register Card" to link it</p>
        </div>
      </div>
    )
    if (status.type === 'saved') return (
      <div className="flex items-start gap-3 bg-green/5 border border-green/20 rounded-xl px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-green flex-shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p className="text-green text-sm font-semibold">Card registered!</p>
          <p className="text-muted text-xs font-mono mt-0.5">UID: {status.uid}</p>
        </div>
      </div>
    )
    return null
  }

  return (
    <div className="space-y-3">
      {resultPanel()}
      <button onClick={onToggleRegister}
        className={clsx(
          'w-full py-2.5 rounded-xl text-sm font-semibold transition-all border',
          hasCard
            ? 'border-border text-muted hover:border-amber hover:text-amber'
            : 'border-accent/40 text-accent hover:bg-accent/5',
        )}>
        {hasCard ? '↺ Replace Card' : '+ Register Card'}
      </button>
    </div>
  )
}