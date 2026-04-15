'use client'

import { useState } from 'react'
import clsx from 'clsx'

interface Package {
  points: number
  amountCents: number   // in PHP centavos
  label: string
  popular?: boolean
}

const PACKAGES: Package[] = [
  { points: 10,  amountCents:  5000, label: '₱50'  },
  { points: 25,  amountCents: 10000, label: '₱100', popular: true },
  { points: 60,  amountCents: 20000, label: '₱200' },
  { points: 150, amountCents: 45000, label: '₱450' },
]

interface Props {
  userId:   string
  userName: string
}

export default function BuyPoints({ userId, userName }: Props) {
  const [selected, setSelected] = useState<Package>(PACKAGES[1])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const handleBuy = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/paymongo/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          userName,
          points:      selected.points,
          amountCents: selected.amountCents,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.checkoutUrl) {
        setError(data.error ?? 'Failed to create payment link')
        setLoading(false)
        return
      }

      // Redirect to PayMongo checkout
      window.location.href = data.checkoutUrl
    } catch (err) {
      console.error('[BuyPoints]', err)
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="w-4 h-4 text-accent">
            <circle cx="12" cy="12" r="10"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Buy Points</p>
          <p className="text-xs text-muted">Pay via PayMongo</p>
        </div>
      </div>

      {/* package grid */}
      <div className="grid grid-cols-2 gap-2">
        {PACKAGES.map((pkg) => (
          <button
            key={pkg.points}
            onClick={() => setSelected(pkg)}
            className={clsx(
              'relative rounded-xl border p-3 text-left transition-all',
              selected.points === pkg.points
                ? 'border-accent/50 bg-accent/5'
                : 'border-border bg-bg hover:border-dim',
            )}
          >
            {pkg.popular && (
              <span className="absolute -top-2 left-3 text-[10px] font-bold uppercase tracking-widest
                               bg-accent text-bg px-1.5 py-0.5 rounded-full">
                popular
              </span>
            )}
            <p className="text-lg font-bold font-mono text-white">{pkg.points}</p>
            <p className="text-xs text-muted">pts</p>
            <p className={clsx(
              'text-xs font-semibold mt-1',
              selected.points === pkg.points ? 'text-accent' : 'text-muted',
            )}>
              {pkg.label}
            </p>
          </button>
        ))}
      </div>

      {/* summary */}
      <div className="flex items-center justify-between bg-bg rounded-xl px-4 py-3 border border-border">
        <div>
          <p className="text-xs text-muted">You get</p>
          <p className="font-mono font-bold text-white">
            {selected.points} <span className="text-accent">pts</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">You pay</p>
          <p className="font-mono font-bold text-white">
            ₱{(selected.amountCents / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* error */}
      {error && (
        <p className="text-red text-xs font-mono px-1">{error}</p>
      )}

      {/* CTA */}
      <button
        onClick={handleBuy}
        disabled={loading}
        className={clsx(
          'w-full py-3 rounded-xl font-semibold text-sm transition-all',
          loading
            ? 'bg-accent/30 text-accent/50 cursor-not-allowed'
            : 'bg-accent text-bg hover:bg-accent/90 active:scale-95',
        )}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
            Redirecting…
          </span>
        ) : (
          `Pay ${(selected.amountCents / 100).toFixed(0) === (selected.amountCents / 100).toString()
            ? `₱${selected.amountCents / 100}`
            : `₱${(selected.amountCents / 100).toFixed(2)}`
          } via PayMongo`
        )}
      </button>

      <p className="text-center text-[11px] text-muted/60">
        Points are added automatically after payment
      </p>
    </div>
  )
}
