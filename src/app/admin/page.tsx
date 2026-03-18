'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import {
  listenAllUsers, listenTransactions,
  adjustPoints, updateUserProfile, deleteUserProfile,
  UserProfile, Transaction,
} from '@/lib/firestore'
import { useMQTT } from '@/hooks/useMQTT'
import Navbar from '@/components/Navbar'
import DoorControl from '@/components/DoorControl'
import TransactionList from '@/components/TransactionList'
import StatCard from '@/components/StatCard'
import clsx from 'clsx'

export default function AdminPage() {
  const { user, profile: authProfile, loading } = useAuth()
  const router = useRouter()
  const { connected, doorState, lastUID, publish } = useMQTT()

  const [users,       setUsers]       = useState<UserProfile[]>([])
  const [txs,         setTxs]         = useState<Transaction[]>([])
  const [tab,         setTab]         = useState<'users' | 'transactions' | 'door' | 'mqtt'>('users')
  const [selected,    setSelected]    = useState<UserProfile | null>(null)
  const [pointAmt,    setPointAmt]    = useState('')
  const [pointReason, setPointReason] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [toast,       setToast]       = useState('')
  const [editCard,    setEditCard]    = useState('')
  const [mqttTopic,   setMqttTopic]   = useState('esp32/led')
  const [mqttPayload, setMqttPayload] = useState('')
  const [search,      setSearch]      = useState('')

  // guards
  useEffect(() => {
    if (!loading && !user)                         router.replace('/login')
    if (!loading && authProfile?.role !== 'admin') router.replace('/dashboard')
  }, [user, authProfile, loading, router])

  useEffect(() => { const u = listenAllUsers(setUsers);         return u }, [])
  useEffect(() => { const u = listenTransactions(setTxs);       return u }, [])

  // update selected user from live list
  useEffect(() => {
    if (!selected) return
    const updated = users.find(u => u.uid === selected.uid)
    if (updated) setSelected(updated)
  }, [users])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const handleAdjustPoints = async (type: 'add' | 'deduct') => {
    if (!selected || !user || !authProfile) return
    const amt = parseInt(pointAmt)
    if (isNaN(amt) || amt <= 0) return
    setBusy(true)
    try {
      const delta = type === 'add' ? amt : -amt
      await adjustPoints(
        selected.uid, delta,
        pointReason || (type === 'add' ? 'Points added by admin' : 'Points deducted by admin'),
        user.uid, authProfile.name, selected.name,
      )
      showToast(`${type === 'add' ? '+' : '-'}${amt} pts for ${selected.name}`)
      setPointAmt('')
      setPointReason('')
    } catch (e) {
      showToast('Error adjusting points')
    }
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
      users.map(u => ({ uid: u.cardUid, level: u.role, name: u.name }))
        .filter(u => u.uid)
    )
    publish('esp32/cards', payload)
    showToast('Card list pushed to ESP32')
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const totalPoints = users.reduce((s, u) => s + (u.points || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-green/30 text-green text-sm font-mono px-5 py-3 rounded-xl shadow-lg animate-slide-up">
          {toast}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-muted text-sm mt-1">Manage users, points &amp; door access</p>
          </div>
          <button
            onClick={publishCards}
            className="flex items-center gap-2 bg-surface border border-border hover:border-accent text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
            </svg>
            Push Cards to ESP32
          </button>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Users"  value={users.filter(u => u.role === 'user').length}  color="cyan"  />
          <StatCard label="Total Points" value={totalPoints} sub="across all users" color="green" />
          <StatCard label="Transactions" value={txs.length}  color="amber" />
          <StatCard label="Door State"   value={doorState}   color={doorState === 'ON' ? 'green' : 'red'} />
        </div>

        {/* tabs */}
        <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-6 w-fit">
          {(['users', 'transactions', 'door', 'mqtt'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx(
                'px-5 py-2 rounded-lg text-sm font-semibold capitalize transition-all',
                tab === t ? 'bg-accent text-bg' : 'text-muted hover:text-white',
              )}>
              {t}
            </button>
          ))}
        </div>

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* user list */}
            <div className="lg:col-span-2">
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search users…"
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-muted focus:outline-none focus:border-accent"
                  />
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
                      <span className="text-sm font-bold font-mono text-accent flex-shrink-0">
                        {u.points}
                      </span>
                    </button>
                  ))}
                  {filteredUsers.filter(u => u.role !== 'admin').length === 0 && (
                    <p className="text-muted text-sm font-mono text-center py-8">No users found</p>
                  )}
                </div>
              </div>
            </div>

            {/* user detail */}
            <div className="lg:col-span-3">
              {selected ? (
                <div className="space-y-4 animate-slide-up">
                  {/* profile card */}
                  <div className="bg-surface border border-border rounded-2xl p-6">
                    <div className="flex items-start justify-between mb-5">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold text-xl">
                          {selected.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">{selected.name}</h3>
                          <p className="text-muted text-sm font-mono">{selected.email}</p>
                          {selected.cardUid && (
                            <p className="text-xs font-mono text-accent mt-1">Card: {selected.cardUid}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold font-mono text-accent">{selected.points}</p>
                        <p className="text-xs text-muted">points</p>
                      </div>
                    </div>

                    {/* adjust points */}
                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Adjust Points</p>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="number" min="1"
                          value={pointAmt} onChange={e => setPointAmt(e.target.value)}
                          placeholder="Amount"
                          className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent"
                        />
                        <input
                          value={pointReason} onChange={e => setPointReason(e.target.value)}
                          placeholder="Reason (optional)"
                          className="flex-[2] bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleAdjustPoints('add')}
                          disabled={busy || !pointAmt}
                          className="py-2.5 rounded-xl bg-green hover:opacity-90 disabled:opacity-40 text-bg font-bold text-sm transition-all">
                          + Add Points
                        </button>
                        <button
                          onClick={() => handleAdjustPoints('deduct')}
                          disabled={busy || !pointAmt}
                          className="py-2.5 rounded-xl bg-red/80 hover:opacity-90 disabled:opacity-40 text-white font-bold text-sm transition-all">
                          − Deduct Points
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* link card */}
                  <div className="bg-surface border border-border rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Link RFID Card</p>
                    <div className="flex gap-2">
                      <input
                        value={editCard} onChange={e => setEditCard(e.target.value)}
                        placeholder={selected.cardUid || 'e.g. A1B2C3D4'}
                        className="flex-1 bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent uppercase"
                      />
                      <button
                        onClick={handleSetCard} disabled={!editCard}
                        className="bg-accent hover:opacity-90 disabled:opacity-40 text-bg font-bold px-4 py-2 rounded-xl text-sm transition-all">
                        Save
                      </button>
                    </div>
                    {lastUID && (
                      <button onClick={() => setEditCard(lastUID)}
                        className="text-xs font-mono text-accent mt-2 hover:underline">
                        Use last scanned: {lastUID}
                      </button>
                    )}
                  </div>

                  {/* danger zone */}
                  <div className="bg-surface border border-red/20 rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-red/70 mb-3">Danger Zone</p>
                    <button
                      onClick={() => handleDeleteUser(selected)}
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
              <button
                onClick={() => { publish(mqttTopic, mqttPayload); showToast('Published!') }}
                disabled={!connected || !mqttPayload}
                className="w-full bg-accent hover:opacity-90 disabled:opacity-40 text-bg font-bold py-2.5 rounded-xl text-sm transition-all">
                Publish
              </button>
            </div>

            {/* quick actions */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">Quick Actions</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Door ON',  topic: 'esp32/led',   payload: 'ON'  },
                  { label: 'Door OFF', topic: 'esp32/led',   payload: 'OFF' },
                  { label: 'Push Cards', topic: 'esp32/cards', payload: '__cards__' },
                ].map(a => (
                  <button key={a.label}
                    onClick={() => {
                      if (a.payload === '__cards__') publishCards()
                      else { publish(a.topic, a.payload); showToast(`Sent: ${a.payload}`) }
                    }}
                    disabled={!connected}
                    className="bg-bg border border-border hover:border-accent disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-all">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* reference */}
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
