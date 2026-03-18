'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const { signIn, signUp, user, profile, loading } = useAuth()
  const router = useRouter()
  const [mode,  setMode]  = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [name,  setName]  = useState('')
  const [err,   setErr]   = useState('')
  const [busy,  setBusy]  = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.replace(profile?.role === 'admin' ? '/admin' : '/dashboard')
    }
  }, [user, profile, loading, router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, pass)
      else                   await signUp(email, pass, name)
    } catch (e: any) {
      setErr(e.message?.replace('Firebase: ', '') || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#22d3ee 1px, transparent 1px), linear-gradient(90deg, #22d3ee 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent opacity-[0.04] blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-green opacity-[0.04] blur-3xl" />

      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        {/* logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface border border-border mb-4 glow-cyan">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-accent" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">RFID<span className="text-accent">/</span>DOOR</h1>
          <p className="text-muted text-sm mt-1 font-mono">Access Control System</p>
        </div>

        <div className="glass rounded-2xl p-8">
          {/* tabs */}
          <div className="flex rounded-xl bg-bg border border-border p-1 mb-7">
            {(['signin', 'signup'] as Mode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); setErr('') }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  mode === m
                    ? 'bg-accent text-bg shadow'
                    : 'text-muted hover:text-white'
                }`}>
                {m === 'signin' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">Full Name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)} required
                  placeholder="John Doe"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@example.com"
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">Password</label>
              <input
                type="password" value={pass} onChange={e => setPass(e.target.value)} required
                placeholder="••••••••"
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {err && (
              <p className="text-red text-xs font-mono bg-red/10 border border-red/20 rounded-lg px-3 py-2">{err}</p>
            )}

            <button type="submit" disabled={busy}
              className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-bg font-bold py-3 rounded-xl transition-all text-sm tracking-wide mt-2">
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
                  {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
                </span>
              ) : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-muted/50 text-xs font-mono mt-6">
          New accounts default to User role
        </p>
      </div>
    </div>
  )
}
