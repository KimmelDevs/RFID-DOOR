'use client'

import { Transaction } from '@/lib/firestore'
import { Timestamp } from 'firebase/firestore'
import clsx from 'clsx'

interface Props {
  transactions: Transaction[]
  showUser?: boolean
}

function fmt(ts: Timestamp | null) {
  if (!ts) return '—'
  return ts.toDate().toLocaleString('en-PH', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function TransactionList({ transactions, showUser = false }: Props) {
  if (!transactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mb-3 opacity-30">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p className="text-sm font-mono">No transactions yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {transactions.map(tx => (
        <div key={tx.id}
          className="flex items-center justify-between bg-bg border border-border rounded-xl px-4 py-3 hover:border-dim transition-colors">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
              tx.type === 'credit' ? 'bg-green/10' : 'bg-red/10',
            )}>
              {tx.type === 'credit' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className="w-4 h-4 text-green">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className="w-4 h-4 text-red">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4"/>
                </svg>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">
                {showUser ? tx.userName : tx.reason}
              </p>
              <p className="text-xs text-muted mt-0.5 font-mono">
                {showUser ? `${tx.reason} · by ${tx.adminName}` : fmt(tx.createdAt)}
              </p>
              {showUser && (
                <p className="text-xs text-muted font-mono">{fmt(tx.createdAt)}</p>
              )}
            </div>
          </div>
          <span className={clsx(
            'text-sm font-bold font-mono',
            tx.type === 'credit' ? 'text-green' : 'text-red',
          )}>
            {tx.type === 'credit' ? '+' : '-'}{tx.amount}
          </span>
        </div>
      ))}
    </div>
  )
}
