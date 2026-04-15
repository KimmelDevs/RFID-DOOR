'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import {
  listenUser, listenUserTransactions,
  Transaction, UserProfile,
  adjustPoints, updateUserProfile,
  findUserByCardUid,
} from '@/lib/firestore'
import { onMQTTMessage, openDoor, connectMQTT } from '@/lib/mqtt'
import { verifyAndParseUID } from '@/lib/hmac'
import { useMQTT } from '@/hooks/useMQTT'
import Navbar from '@/components/Navbar'
import DoorControl from '@/components/DoorControl'
import TransactionList from '@/components/TransactionList'
import StatCard from '@/components/StatCard'
import BuyPoints from '@/components/BuyPoints'
import clsx from 'clsx'

const COST_PER_OPEN = 1

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
  const searchParams = useSearchParams()
  const { connected, doorState, roofState, lastUID } = useMQTT()

  const [profile,        setProfile]        = useState<UserProfile | null>(null)
  const [txs,            setTxs]            = useState<Transaction[]>([])
  const [scanStatus,     setScanStatus]     = useState<ScanStatus>({ type: 'idle' })
  const [registerMode,   setRegisterMode]   = useState(false)
  const [paymentToast,   setPaymentToast]   = useState<'success' | 'failed' | null>(null)

  // keep a ref to the latest profile so MQTT callback always sees fresh data
  const profileRef           = useRef<UserProfile | null>(null)
  useEffect(() => { profileRef.current = profile }, [profile])

  // keep a ref to registerMode for the same reason
  const registerModeRef      = useRef(false)
  const processingRef        = useRef(false)
  const lastProcessedPayload = useRef<string>('')  // dedup
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

  // handle PayMongo redirect result
  useEffect(() => {
    const status = searchParams.get('payment')
    if (status === 'success' || status === 'failed') {
      setPaymentToast(status as 'success' | 'failed')
      // clean query param without full reload
      const url = new URL(window.location.href)
      url.searchParams.delete('payment')
      url.searchParams.delete('points')
      window.history.replaceState({}, '', url.toString())
      setTimeout(() => setPaymentToast(null), 5000)
    }
  }, [searchParams])

  // ── RFID scan handler via MQTT ──────────────────────────────────────────────
  const rfidUnsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!user) return

    // Clean up any stale subscription first (React Strict Mode double-invoke fix)
    if (rfidUnsubRef.current) {
      rfidUnsubRef.current()
      rfidUnsubRef.current = null
    }

    connectMQTT()

    const unsub = onMQTTMessage(async (topic, payload) => {
      const t = payload.trim()

      // Debug: log every MQTT message
      console.log('[MQTT]', topic, '->', t.slice(0, 80))

      if (!topic.includes('card_uid')) return

      // Deduplicate: same payload already handled
      if (t === lastProcessedPayload.current) {
        console.log('[RFID] duplicate payload ignored')
        return
      }

      console.log('[RFID] card_uid received, processing locked:', processingRef.current)
      if (processingRef.current) return

      lastProcessedPayload.current = t

      // Verify HMAC signature before doing anything
      const parsed = await verifyAndParseUID(t)
      console.log('[RFID] HMAC verify result:', parsed)
      if (!parsed.valid) {
        console.warn('[RFID] Rejected:', parsed.reason)
        return
      }

      const uid = parsed.uid.toUpperCase()
      processingRef.current = true
      setScanStatus({ type: 'scanning' })

      try {
        const currentProfile = profileRef.current

        // ── REGISTER MODE: save UID to this user's account ──────────────────
        if (registerModeRef.current) {
          setScanStatus({ type: 'saving', uid })
          await updateUserProfile(user.uid, { cardUid: uid })
          setScanStatus({ type: 'saved', uid })
          setRegisterMode(false)
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // ── NORMAL MODE: look up card in Firestore ───────────────────────────
        const cardOwner = await findUserByCardUid(uid)

        if (!cardOwner) {
          // Card not registered to anyone
          setScanStatus({ type: 'unknown', uid })
          setTimeout(() => setScanStatus({ type: 'idle' }), 5000)
          processingRef.current = false
          return
        }

        // Card belongs to this user?
        if (cardOwner.uid !== user.uid) {
          setScanStatus({
            type: 'denied',
            uid,
            message: 'This card is registered to a different account',
          })
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // Check points
        if ((cardOwner.points ?? 0) < COST_PER_OPEN) {
          setScanStatus({
            type: 'denied',
            uid,
            message: `Insufficient points (need ${COST_PER_OPEN}, have ${cardOwner.points ?? 0})`,
          })
          setTimeout(() => setScanStatus({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // ✅ All good — open door + deduct points
        openDoor()
        await adjustPoints(
          user.uid,
          -COST_PER_OPEN,
          'Door opened via RFID card',
          'system',
          'System',
          cardOwner.name,
        )
        setScanStatus({
          type: 'success',
          uid,
          message: `Welcome, ${cardOwner.name}! −${COST_PER_OPEN} pt`,
        })
        setTimeout(() => setScanStatus({ type: 'idle' }), 5000)
      } catch (err) {
        console.error('RFID handler error', err)
        setScanStatus({ type: 'idle' })
      }

      setTimeout(() => { lastProcessedPayload.current = '' }, 4000)
      processingRef.current = false
    })

    rfidUnsubRef.current = unsub
    return () => {
      unsub()
      rfidUnsubRef.current = null
    }
  }, [user]) // subscribe once only

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

      {/* Payment result toast */}
      {paymentToast && (
        <div className={clsx(
          'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl border shadow-lg',
          'flex items-center gap-3 text-sm font-semibold animate-slide-up',
          paymentToast === 'success'
            ? 'bg-green/10 border-green/30 text-green'
            : 'bg-red/10 border-red/30 text-red',
        )}>
          {paymentToast === 'success' ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Payment successful! Points will be added shortly.
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Payment was not completed.
            </>
          )}
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8 animate-slide-up">
        {/* welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">
            Hey, <span className="text-accent">{profile.name}</span> 👋
          </h1>
          <p className="text-muted text-sm mt-1">
            Use your RFID card or the button below to unlock the door
          </p>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <StatCard label="Points"       value={profile.points}  sub="available" color="cyan"  />
          <StatCard label="Total Earned" value={totalCredits}    sub="all time"  color="green" />
          <StatCard label="Total Used"   value={totalDebits}     sub="all time"  color="amber" />
          <StatCard label="Door Opens"   value={opens}           sub="all time"  color="red"   />
          <StatCard label="Roof"         value={roofState}       sub="current"   color={roofState === 'ON' ? 'amber' : 'cyan'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div className="lg:col-span-1 space-y-4">

            {/* Door control (manual button) */}
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

            {/* ── RFID CARD SECTION ──────────────────────────────────────── */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">RFID Card</h2>
              <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">

                {/* Current linked card */}
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

                {/* Register / scan status */}
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

            {/* ── BUY POINTS ─────────────────────────────────────────────── */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">Top Up</h2>
              <BuyPoints userId={user!.uid} userName={profile.name} />
            </div>

          </div>

          {/* ── TRANSACTIONS ────────────────────────────────────────────── */}
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

// ── Scan Status Panel ────────────────────────────────────────────────────────

function ScanStatusPanel({
  status, registerMode, onToggleRegister, hasCard,
}: {
  status: ScanStatus
  registerMode: boolean
  onToggleRegister: () => void
  hasCard: boolean
}) {
  if (registerMode) {
    return (
      <div className="space-y-3">
        {/* pulsing scan prompt */}
        <div className="relative flex flex-col items-center justify-center gap-3 bg-accent/5 border border-accent/20 rounded-xl py-6 overflow-hidden">
          {/* animated ring */}
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

          {/* saving state */}
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

  // Scan result displays
  const resultPanel = () => {
    if (status.type === 'scanning') {
      return (
        <div className="flex items-center gap-3 bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-accent text-sm font-mono">Reading card…</span>
        </div>
      )
    }
    if (status.type === 'success') {
      return (
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
    }
    if (status.type === 'denied') {
      return (
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
    }
    if (status.type === 'unknown') {
      return (
        <div className="flex items-start gap-3 bg-amber/5 border border-amber/20 rounded-xl px-4 py-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-amber flex-shrink-0 mt-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div>
            <p className="text-amber text-sm font-semibold">Card not registered</p>
            <p className="text-muted text-xs font-mono mt-0.5">UID: {status.uid}</p>
            <p className="text-muted text-xs mt-1">Use "Register Card" to link it to your account</p>
          </div>
        </div>
      )
    }
    if (status.type === 'saved') {
      return (
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
    }
    return null
  }

  return (
    <div className="space-y-3">
      {resultPanel()}
      <button
        onClick={onToggleRegister}
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