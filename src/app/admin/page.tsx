'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import {
  listenAllUsers, listenTransactions,
  adjustPoints, updateUserProfile, deleteUserProfile,
  findUserByCardUid,
  UserProfile, Transaction,
} from '@/lib/firestore'
import { useMQTT } from '@/hooks/useMQTT'
import { onMQTTMessage, publishMQTT, connectMQTT } from '@/lib/mqtt'
import { verifyAndParseUID } from '@/lib/hmac'
import Navbar from '@/components/Navbar'
import DoorControl from '@/components/DoorControl'
import TransactionList from '@/components/TransactionList'
import StatCard from '@/components/StatCard'
import clsx from 'clsx'

const COST_PER_OPEN = 1
const DOOR_TOPIC    = 'esp32/led'

type ScanLogEntry = (
  | { type: 'granted'; uid: string; name: string; points: number }
  | { type: 'denied';  uid: string; reason: string }
  | { type: 'unknown'; uid: string }
) & { time: string }

type ScanEvent =
  | { type: 'idle' }
  | { type: 'scanning'; uid: string }
  | { type: 'granted';  uid: string; name: string; points: number }
  | { type: 'denied';   uid: string; reason: string }
  | { type: 'unknown';  uid: string }

export default function AdminPage() {
  const { user, profile: authProfile, loading } = useAuth()
  const router = useRouter()
  const { connected, doorState, lastUID, publish } = useMQTT()

  const [users,       setUsers]       = useState<UserProfile[]>([])
  const [txs,         setTxs]         = useState<Transaction[]>([])
  const [tab,         setTab]         = useState<'users' | 'transactions' | 'door' | 'mqtt' | 'scan'>('scan')
  const [selected,    setSelected]    = useState<UserProfile | null>(null)
  const [pointAmt,    setPointAmt]    = useState('')
  const [pointReason, setPointReason] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [toast,       setToast]       = useState<{ msg: string; type: 'ok' | 'err' }>({ msg: '', type: 'ok' })
  const [editCard,    setEditCard]    = useState('')
  const [mqttTopic,   setMqttTopic]   = useState('esp32/led')
  const [mqttPayload, setMqttPayload] = useState('')
  const [search,      setSearch]      = useState('')
  const [scanEvent,   setScanEvent]   = useState<ScanEvent>({ type: 'idle' })
  const [scanLog,     setScanLog]     = useState<ScanLogEntry[]>([])
  const [countdown,   setCountdown]   = useState<number | null>(null)

  // Refs so MQTT callback always sees fresh data without re-subscribing
  const processingRef  = useRef(false)
  const usersRef       = useRef<UserProfile[]>([])
  const countdownRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => { usersRef.current = users }, [users])

  const startCountdown = (seconds = 60) => {
    // clear any existing countdown
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(seconds)
    let remaining = seconds
    countdownRef.current = setInterval(() => {
      remaining -= 1
      setCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(countdownRef.current!)
        countdownRef.current = null
        setCountdown(null)
        publishMQTT(DOOR_TOPIC, 'OFF')
        showToast('Auto-closed after 60s')
      }
    }, 1000)
  }

  // guards
  useEffect(() => {
    if (!loading && !user)                         router.replace('/login')
    if (!loading && authProfile?.role !== 'admin') router.replace('/dashboard')
  }, [user, authProfile, loading, router])

  useEffect(() => { return listenAllUsers(setUsers)   }, [])
  useEffect(() => { return listenTransactions(setTxs) }, [])

  // keep selected user fresh
  useEffect(() => {
    if (!selected) return
    const updated = users.find(u => u.uid === selected.uid)
    if (updated) setSelected(updated)
  }, [users])

  // ── RFID BRAIN — runs in admin, works without user dashboard open ───────────
  useEffect(() => {
    if (!user) return
    connectMQTT()

    const unsub = onMQTTMessage(async (topic, payload) => {
      const t = payload.trim()

      // Debug: log every MQTT message
      console.log('[MQTT]', topic, '->', t.slice(0, 80))

      if (!topic.includes('card_uid')) return
      console.log('[RFID] card_uid received, processing locked:', processingRef.current)
      if (processingRef.current) return

      processingRef.current = true

      // Verify HMAC signature
      const parsed = await verifyAndParseUID(t)
      console.log('[RFID] HMAC verify result:', parsed)
      if (!parsed.valid) {
        console.warn('[RFID] Rejected:', parsed.reason, '| payload:', t)
        processingRef.current = false
        return
      }

      const uid = parsed.uid.toUpperCase()
      const now = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

      setScanEvent({ type: 'scanning', uid })

      try {
        const cardOwner = await findUserByCardUid(uid)

        if (!cardOwner) {
          publishMQTT(DOOR_TOPIC, 'DENY')
          const ev: ScanEvent = { type: 'unknown', uid }
          setScanEvent(ev)
          setScanLog(l => [{ ...ev, time: now } as ScanLogEntry, ...l.slice(0, 49)])
          setTimeout(() => setScanEvent({ type: 'idle' }), 5000)
          processingRef.current = false
          return
        }

        // ✅ Registered card — toggle door
        const isCurrentlyOpen = countdownRef.current !== null

        if (isCurrentlyOpen) {
          // Door is open — close it (no points deducted for closing)
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
          setCountdown(null)
          publishMQTT(DOOR_TOPIC, 'OFF')

          const ev: ScanEvent = { type: 'granted', uid, name: cardOwner.name, points: cardOwner.points ?? 0 }
          setScanEvent({ ...ev, name: `${cardOwner.name} (closed door)` } as ScanEvent)
          setScanLog(l => [{ ...ev, time: now, name: `${cardOwner.name} — closed door` } as ScanLogEntry, ...l.slice(0, 49)])
          showToast(`Door closed by ${cardOwner.name}`)
          setTimeout(() => setScanEvent({ type: 'idle' }), 4000)
          processingRef.current = false
          return
        }

        // Door is closed — check points before opening
        if ((cardOwner.points ?? 0) < COST_PER_OPEN) {
          publishMQTT(DOOR_TOPIC, 'DENY')
          const ev: ScanEvent = { type: 'denied', uid, reason: `Insufficient points (${cardOwner.points ?? 0} pts)` }
          setScanEvent(ev)
          setScanLog(l => [{ ...ev, time: now } as ScanLogEntry, ...l.slice(0, 49)])
          setTimeout(() => setScanEvent({ type: 'idle' }), 5000)
          processingRef.current = false
          return
        }

        // Open it and deduct points
        const sent = publishMQTT(DOOR_TOPIC, 'ON')
        startCountdown(60)
        if (!sent) {
          await new Promise(r => setTimeout(r, 600))
          publishMQTT(DOOR_TOPIC, 'ON')
        }

        await adjustPoints(
          cardOwner.uid, -COST_PER_OPEN,
          'Door opened via RFID card',
          'system', 'System', cardOwner.name,
        )

        const ev: ScanEvent = { type: 'granted', uid, name: cardOwner.name, points: (cardOwner.points ?? 0) - COST_PER_OPEN }
        setScanEvent(ev)
        setScanLog(l => [{ ...ev, time: now } as ScanLogEntry, ...l.slice(0, 49)])
        setTimeout(() => setScanEvent({ type: 'idle' }), 5000)

      } catch (err) {
        console.error('[RFID Brain]', err)
        setScanEvent({ type: 'idle' })
      }

      processingRef.current = false
    })

    return unsub
  }, [user]) // subscribe once only

  // ── helpers ─────────────────────────────────────────────────────────────────
  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '', type: 'ok' }), 2500)
  }

  const handleAdjustPoints = async (type: 'add' | 'deduct') => {
    if (!selected || !user || !authProfile) return
    const amt = parseInt(pointAmt)
    if (isNaN(amt) || amt <= 0) return
    setBusy(true)
    try {
      await adjustPoints(
        selected.uid, type === 'add' ? amt : -amt,
        pointReason || (type === 'add' ? 'Points added by admin' : 'Points deducted by admin'),
        user.uid, authProfile.name, selected.name,
      )
      showToast(`${type === 'add' ? '+' : '-'}${amt} pts for ${selected.name}`)
      setPointAmt('')
      setPointReason('')
    } catch { showToast('Error adjusting points', 'err') }
    setBusy(false)
  }

  const handleSetCard = async () => {
    if (!selected || !editCard) return
    await updateUserProfile(selected.uid, { cardUid: editCard.toUpperCase().trim() })
    showToast(`Card linked: ${editCard.toUpperCase()}`)
    setEditCard('')
  }

  const handleDeleteUser = async (u: UserProfile) => {
    if (!confirm(`Delete ${u.name}?`)) return
    await deleteUserProfile(u.uid)
    setSelected(null)
    showToast(`Deleted ${u.name}`)
  }

  const publishCards = () => {
    const payload = JSON.stringify(
      users.map(u => ({ uid: u.cardUid, level: u.role, name: u.name })).filter(u => u.uid)
    )
    publish('esp32/cards', payload)
    showToast('Card list pushed to ESP32')
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const totalPoints = users.reduce((s, u) => s + (u.points || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-bg">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* toast */}
      {toast.msg && (
        <div className={clsx(
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm font-mono px-5 py-3 rounded-xl shadow-lg animate-slide-up border',
          toast.type === 'ok'
            ? 'bg-surface border-green/30 text-green'
            : 'bg-surface border-red/30 text-red',
        )}>
          {toast.msg}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-muted text-sm mt-1">Manage users, points &amp; door access</p>
          </div>
          <button onClick={publishCards}
            className="flex items-center gap-2 bg-surface border border-border hover:border-accent text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
            </svg>
            Push Cards to ESP32
          </button>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Users"  value={users.filter(u => u.role === 'user').length} color="cyan"  />
          <StatCard label="Total Points" value={totalPoints} sub="across all users"          color="green" />
          <StatCard label="Transactions" value={txs.length}                                  color="amber" />
          <StatCard label="Door"         value={doorState}   color={doorState === 'ON' ? 'green' : 'red'} />
        </div>

        {/* tabs */}
        <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-6 w-fit flex-wrap">
          {(['scan', 'users', 'transactions', 'door', 'mqtt'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx(
                'px-5 py-2 rounded-lg text-sm font-semibold capitalize transition-all relative',
                tab === t ? 'bg-accent text-bg' : 'text-muted hover:text-white',
              )}>
              {t === 'scan' ? 'Live Access' : t}
              {/* dot when scan event is active */}
              {t === 'scan' && scanEvent.type !== 'idle' && tab !== 'scan' && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green dot-blink" />
              )}
            </button>
          ))}
        </div>

        {/* ── LIVE ACCESS TAB ── */}
        {tab === 'scan' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* live scan status */}
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Door Brain</h2>
                <div className="flex items-center gap-2">
                  <span className={clsx('w-2 h-2 rounded-full', connected ? 'bg-green dot-blink' : 'bg-red')} />
                  <span className="text-xs font-mono text-muted">{connected ? 'Listening' : 'Offline'}</span>
                </div>
              </div>

              {/* big status display */}
              <div className={clsx(
                'rounded-2xl p-8 flex flex-col items-center gap-4 transition-all duration-300',
                scanEvent.type === 'idle'     && 'bg-bg border border-border',
                scanEvent.type === 'scanning' && 'bg-accent/5 border border-accent/30',
                scanEvent.type === 'granted'  && 'bg-green/5 border border-green/30',
                scanEvent.type === 'denied'   && 'bg-red/5 border border-red/30',
                scanEvent.type === 'unknown'  && 'bg-amber/5 border border-amber/30',
              )}>
                {scanEvent.type === 'idle' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-muted">
                        <rect x="2" y="5" width="20" height="14" rx="2"/>
                        <path strokeLinecap="round" d="M2 10h20"/>
                      </svg>
                    </div>
                    <p className="text-muted font-mono text-sm">Waiting for card scan…</p>
                  </>
                )}

                {scanEvent.type === 'scanning' && (
                  <>
                    <div className="relative w-16 h-16 rounded-full border-2 border-accent flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-accent">
                        <rect x="2" y="5" width="20" height="14" rx="2"/>
                        <path strokeLinecap="round" d="M2 10h20"/>
                      </svg>
                      <span className="absolute inset-0 rounded-full border-2 border-accent animate-ping opacity-30" />
                    </div>
                    <p className="text-accent font-semibold">Checking card…</p>
                    <p className="text-muted font-mono text-xs">{scanEvent.uid}</p>
                  </>
                )}

                {scanEvent.type === 'granted' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-green/20 border-2 border-green flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-green">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-green font-bold text-lg">ACCESS GRANTED</p>
                      <p className="text-white font-semibold mt-1">{scanEvent.name}</p>
                      <p className="text-muted font-mono text-xs mt-1">{scanEvent.uid} · {scanEvent.points} pts remaining</p>
                    </div>
                  </>
                )}

                {scanEvent.type === 'denied' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-red/20 border-2 border-red flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-red">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-red font-bold text-lg">ACCESS DENIED</p>
                      <p className="text-muted font-mono text-xs mt-1">{scanEvent.uid}</p>
                      <p className="text-muted text-sm mt-1">{scanEvent.reason}</p>
                    </div>
                  </>
                )}

                {scanEvent.type === 'unknown' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-amber/20 border-2 border-amber flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-amber">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-amber font-bold text-lg">UNKNOWN CARD</p>
                      <p className="text-muted font-mono text-xs mt-1">{scanEvent.uid}</p>
                      <p className="text-muted text-sm mt-1">Not registered in the system</p>
                    </div>
                  </>
                )}
              </div>

              {/* countdown bar */}
              {countdown !== null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-amber font-semibold">Auto-closing in</span>
                    <span className={countdown <= 10 ? 'text-red font-bold' : 'text-amber font-bold'}>
                      {countdown}s
                    </span>
                  </div>
                  <div className="h-2 bg-bg rounded-full overflow-hidden border border-border">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${countdown <= 10 ? 'bg-red' : 'bg-amber'}`}
                      style={{ width: `${(countdown / 60) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* manual door override */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button onClick={() => { publishMQTT(DOOR_TOPIC, 'ON'); startCountdown(60); showToast('Door opened — auto-closes in 60s') }}
                  disabled={!connected}
                  className="py-2.5 rounded-xl bg-green hover:opacity-90 disabled:opacity-40 text-bg font-bold text-sm transition-all">
                  Force Open
                </button>
                <button onClick={() => {
                    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(null) }
                    publishMQTT(DOOR_TOPIC, 'OFF')
                    showToast('Door closed')
                  }}
                  disabled={!connected}
                  className="py-2.5 rounded-xl border border-border hover:border-accent text-white font-bold text-sm transition-all disabled:opacity-40">
                  Force Close
                </button>
              </div>
            </div>

            {/* scan log */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Scan Log</h2>
                <button onClick={() => setScanLog([])} className="text-xs text-muted hover:text-red transition-colors font-mono">
                  Clear
                </button>
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {scanLog.length === 0 && (
                  <p className="text-muted text-sm font-mono text-center py-8">No scans yet this session</p>
                )}
                {scanLog.map((ev, i) => (
                  <div key={i} className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm',
                    ev.type === 'granted' && 'bg-green/5 border-green/20',
                    ev.type === 'denied'  && 'bg-red/5 border-red/20',
                    ev.type === 'unknown' && 'bg-amber/5 border-amber/20',
                  )}>
                    <span className={clsx(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      ev.type === 'granted' && 'bg-green',
                      ev.type === 'denied'  && 'bg-red',
                      ev.type === 'unknown' && 'bg-amber',
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className={clsx(
                        'font-semibold leading-none',
                        ev.type === 'granted' && 'text-green',
                        ev.type === 'denied'  && 'text-red',
                        ev.type === 'unknown' && 'text-amber',
                      )}>
                        {ev.type === 'granted' ? `✓ ${ev.name}` :
                         ev.type === 'denied'  ? `✗ Denied — ${ev.reason}` :
                                                 '? Unknown card'}
                      </p>
                      <p className="text-muted font-mono text-xs mt-0.5">{ev.uid}</p>
                    </div>
                    <span className="text-muted font-mono text-xs flex-shrink-0">{ev.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search users…"
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-muted focus:outline-none focus:border-accent" />
                </div>
                <div className="max-h-[520px] overflow-y-auto">
                  {filteredUsers.filter(u => u.role !== 'admin').map(u => (
                    <button key={u.uid} onClick={() => setSelected(u)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-bg transition-colors text-left',
                        selected?.uid === u.uid && 'bg-accent/5 border-l-2 border-l-accent',
                      )}>
                      <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                        {u.name[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{u.name}</p>
                        <p className="text-xs text-muted font-mono truncate">{u.email}</p>
                      </div>
                      <span className="text-sm font-bold font-mono text-accent flex-shrink-0">{u.points}</span>
                    </button>
                  ))}
                  {filteredUsers.filter(u => u.role !== 'admin').length === 0 && (
                    <p className="text-muted text-sm font-mono text-center py-8">No users found</p>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              {selected ? (
                <div className="space-y-4 animate-slide-up">
                  <div className="bg-surface border border-border rounded-2xl p-6">
                    <div className="flex items-start justify-between mb-5">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-xl">
                          {selected.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{selected.name}</h3>
                          <p className="text-muted text-sm font-mono">{selected.email}</p>
                          {selected.cardUid
                            ? <p className="text-xs font-mono text-accent mt-1">Card: {selected.cardUid}</p>
                            : <p className="text-xs font-mono text-muted mt-1">No card linked</p>
                          }
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold font-mono text-accent">{selected.points}</p>
                        <p className="text-xs text-muted">points</p>
                      </div>
                    </div>

                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Adjust Points</p>
                      <div className="flex gap-2 mb-2">
                        <input type="number" min="1" value={pointAmt} onChange={e => setPointAmt(e.target.value)}
                          placeholder="Amount"
                          className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent" />
                        <input value={pointReason} onChange={e => setPointReason(e.target.value)}
                          placeholder="Reason (optional)"
                          className="flex-[2] bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => handleAdjustPoints('add')} disabled={busy || !pointAmt}
                          className="py-2.5 rounded-xl bg-green hover:opacity-90 disabled:opacity-40 text-bg font-bold text-sm">
                          + Add Points
                        </button>
                        <button onClick={() => handleAdjustPoints('deduct')} disabled={busy || !pointAmt}
                          className="py-2.5 rounded-xl bg-red/80 hover:opacity-90 disabled:opacity-40 text-white font-bold text-sm">
                          − Deduct Points
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-surface border border-border rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Link RFID Card</p>
                    <div className="flex gap-2">
                      <input value={editCard} onChange={e => setEditCard(e.target.value)}
                        placeholder={selected.cardUid || 'e.g. A5D3064939'}
                        className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent uppercase" />
                      <button onClick={handleSetCard} disabled={!editCard}
                        className="bg-accent hover:opacity-90 disabled:opacity-40 text-bg font-bold px-4 py-2 rounded-xl text-sm">
                        Save
                      </button>
                    </div>
                    {lastUID && (
                      <button onClick={() => setEditCard(lastUID)}
                        className="text-xs font-mono text-accent mt-2 hover:underline block">
                        Use last scanned: {lastUID}
                      </button>
                    )}
                  </div>

                  <div className="bg-surface border border-red/20 rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-red/70 mb-3">Danger Zone</p>
                    <button onClick={() => handleDeleteUser(selected)}
                      className="text-sm text-red border border-red/30 hover:bg-red/10 px-4 py-2 rounded-xl transition-all font-semibold">
                      Delete User
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-muted">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mb-3 opacity-30">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
                  </svg>
                  <p className="text-sm font-mono">Select a user to manage</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS TAB ── */}
        {tab === 'transactions' && (
          <div className="bg-surface border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted">All Transactions</h2>
              <span className="text-xs font-mono text-muted">{txs.length} total</span>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              <TransactionList transactions={txs} showUser />
            </div>
          </div>
        )}

        {/* ── DOOR TAB ── */}
        {tab === 'door' && (
          <div className="max-w-sm">
            <DoorControl points={0} adminMode />
          </div>
        )}

        {/* ── MQTT TAB ── */}
        {tab === 'mqtt' && (
          <div className="max-w-lg space-y-6">
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted">Manual Publish</h2>
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-muted block mb-2">Topic</label>
                <input value={mqttTopic} onChange={e => setMqttTopic(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-muted block mb-2">Payload</label>
                <input value={mqttPayload} onChange={e => setMqttPayload(e.target.value)}
                  placeholder="ON / OFF / custom…"
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent" />
              </div>
              <button onClick={() => { publish(mqttTopic, mqttPayload); showToast('Published!') }}
                disabled={!connected || !mqttPayload}
                className="w-full bg-accent hover:opacity-90 disabled:opacity-40 text-bg font-bold py-2.5 rounded-xl text-sm">
                Publish
              </button>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">Quick Actions</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Door ON',    cb: () => { publishMQTT('esp32/led', 'ON');  showToast('Sent ON')  } },
                  { label: 'Door OFF',   cb: () => { publishMQTT('esp32/led', 'OFF'); showToast('Sent OFF') } },
                  { label: 'Push Cards', cb: publishCards },
                ].map(a => (
                  <button key={a.label} onClick={a.cb} disabled={!connected}
                    className="bg-bg border border-border hover:border-accent disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-all">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">Topic Reference</h2>
              <div className="space-y-2 text-xs font-mono">
                {[
                  { topic: 'esp32/led',      desc: 'Door control · ON / OFF' },
                  { topic: 'esp32/cards',    desc: 'Card list JSON push' },
                  { topic: 'esp32/card_uid', desc: 'Scanned UID from device' },
                ].map(r => (
                  <div key={r.topic} className="flex gap-3">
                    <span className="text-accent">{r.topic}</span>
                    <span className="text-muted">—</span>
                    <span className="text-white/60">{r.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}