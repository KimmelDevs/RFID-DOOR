'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'signin' | 'signup'

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

interface PasswordInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  label: string
  id: string
}

function PasswordInput({ value, onChange, placeholder, required, label, id }: PasswordInputProps) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || '••••••••'}
          required={required}
          className="w-full bg-bg border border-border rounded-xl px-4 py-3 pr-11 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
          tabIndex={-1}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { signIn, signUp, user, profile, loading } = useAuth()
  const router = useRouter()

  const [mode,    setMode]    = useState<Mode>('signin')
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [name,    setName]    = useState('')
  const [err,     setErr]     = useState('')
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.replace(profile?.role === 'admin' ? '/admin' : '/dashboard')
    }
  }, [user, profile, loading, router])

  const passwordsMatch = mode === 'signin' || pass === confirm
  const passwordStrong = pass.length >= 6

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')

    if (mode === 'signup') {
      if (!passwordStrong) { setErr('Password must be at least 6 characters'); return }
      if (!passwordsMatch) { setErr('Passwords do not match'); return }
    }

    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, pass)
      else                   await signUp(email, pass, name)
    } catch (e: any) {
      const msg = e.message || ''
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential'))
        setErr('Invalid email or password')
      else if (msg.includes('email-already-in-use'))
        setErr('Email already registered — try signing in')
      else if (msg.includes('weak-password'))
        setErr('Password is too weak')
      else
        setErr(msg.replace('Firebase: ', '').split('(')[0].trim())
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setErr('')
    setPass('')
    setConfirm('')
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
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent opacity-[0.04] blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-green opacity-[0.04] blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        {/* logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface border border-border mb-4 glow-cyan">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-accent" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            RFID<span className="text-accent">/</span>DOOR
          </h1>
          <p className="text-muted text-sm mt-1 font-mono">Access Control System</p>
        </div>

        <div className="glass rounded-2xl p-8">
          {/* mode tabs */}
          <div className="flex rounded-xl bg-bg border border-border p-1 mb-7">
            {(['signin', 'signup'] as Mode[]).map(m => (
              <button key={m} type="button" onClick={() => switchMode(m)}
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
                <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
                  Full Name
                </label>
                <input
                  id="name"
                  value={name} onChange={e => setName(e.target.value)} required
                  placeholder="John Doe"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-widest text-muted mb-2">
                Email
              </label>
              <input
                id="email"
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@example.com"
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <PasswordInput
              id="password"
              label="Password"
              value={pass}
              onChange={setPass}
              required
            />

            {mode === 'signup' && (
              <>
                <PasswordInput
                  id="confirm"
                  label="Confirm Password"
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="Re-enter password"
                  required
                />

                {/* password match indicator */}
                {confirm.length > 0 && (
                  <div className={`flex items-center gap-2 text-xs font-mono px-1 ${
                    passwordsMatch ? 'text-green' : 'text-red'
                  }`}>
                    <span>{passwordsMatch ? '✓' : '✗'}</span>
                    <span>{passwordsMatch ? 'Passwords match' : 'Passwords do not match'}</span>
                  </div>
                )}

                {/* strength bar */}
                {pass.length > 0 && (
                  <div className="space-y-1 px-1">
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          pass.length < 6  ? 'bg-red w-1/4' :
                          pass.length < 10 ? 'bg-amber w-2/4' :
                                             'bg-green w-full'
                        }`}
                      />
                    </div>
                    <p className={`text-xs font-mono ${
                      pass.length < 6  ? 'text-red' :
                      pass.length < 10 ? 'text-amber' :
                                         'text-green'
                    }`}>
                      {pass.length < 6 ? 'Too short' : pass.length < 10 ? 'Acceptable' : 'Strong'}
                    </p>
                  </div>
                )}
              </>
            )}

            {err && (
              <p className="text-red text-xs font-mono bg-red/10 border border-red/20 rounded-lg px-3 py-2">
                {err}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || (mode === 'signup' && (!passwordsMatch || !passwordStrong))}
              className="w-full bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-bold py-3 rounded-xl transition-all text-sm tracking-wide mt-1"
            >
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
          New accounts are User role by default
        </p>
      </div>
    </div>
  )
}