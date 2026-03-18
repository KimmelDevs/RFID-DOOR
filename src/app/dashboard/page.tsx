'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { listenUser, listenUserTransactions, Transaction, UserProfile, adjustPoints } from '@/lib/firestore'
import { useMQTT } from '@/hooks/useMQTT'
import Navbar from '@/components/Navbar'
import DoorControl from '@/components/DoorControl'
import TransactionList from '@/components/TransactionList'
import StatCard from '@/components/StatCard'
import clsx from 'clsx'

const COST_PER_OPEN = 1

export default function DashboardPage() {
  const { user, profile: authProfile, loading } = useAuth()
  const router = useRouter()
  const { connected, doorState, lastUID } = useMQTT()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [txs,     setTxs]     = useState<Transaction[]>([])
  const [spentMsg, setSpentMsg] = useState('')

  // redirect guards
  useEffect(() => {
    if (!loading && !user)                         router.replace('/login')
    if (!loading && authProfile?.role === 'admin') router.replace('/admin')
  }, [user, authProfile, loading, router])

  // real-time profile
  useEffect(() => {
    if (!user) return
    const unsub = listenUser(user.uid, p => setProfile(p))
    return unsub
  }, [user])

  // real-time transactions
  useEffect(() => {
    if (!user) return
    const unsub = listenUserTransactions(user.uid, setTxs)
    return unsub
  }, [user])

  // deduct points when door is opened
  const handlePointsSpent = async (amount: number) => {
    if (!user || !profile) return
    try {
      await adjustPoints(
        user.uid, -amount,
        'Door opened via app',
        'system', 'System',
        profile.name,
      )
      setSpentMsg(`-${amount} pt`)
      setTimeout(() => setSpentMsg(''), 2000)
    } catch (e) {
      console.error('Failed to deduct points', e)
    }
  }

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
        {/* welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">
            Hey, <span className="text-accent">{profile.name}</span> 👋
          </h1>
          <p className="text-muted text-sm mt-1">
            Use your points to unlock the door
          </p>
        </div>

        {/* stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Points"
            value={profile.points}
            sub="available"
            color="cyan"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="12" cy="12" r="10"/>
                <path strokeLinecap="round" d="M12 6v6l4 2"/>
              </svg>
            }
          />
          <StatCard label="Total Earned" value={totalCredits} sub="all time" color="green" />
          <StatCard label="Total Used"   value={totalDebits}  sub="all time" color="amber" />
          <StatCard label="Door Opens"   value={opens}        sub="all time" color="red"   />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Door control */}
          <div className="lg:col-span-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted mb-3">Door Access</h2>
            <DoorControl
              points={profile.points}
              costPerOpen={COST_PER_OPEN}
              onPointsSpent={handlePointsSpent}
            />

            {/* card UID display */}
            {lastUID && (
              <div className="mt-4 bg-surface border border-border rounded-xl p-4">
                <p className="text-xs font-mono text-muted uppercase tracking-widest mb-1">Last Scanned Card</p>
                <p className="text-accent font-mono font-bold tracking-widest">{lastUID}</p>
              </div>
            )}
          </div>

          {/* transactions */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Transaction History</h2>
              <span className="text-xs font-mono text-muted">{txs.length} records</span>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-4 max-h-[460px] overflow-y-auto">
              <TransactionList transactions={txs} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
